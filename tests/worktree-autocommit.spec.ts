/**
 * 0.10.2 worktree auto-commit: REAL-git integration (skipped when no git
 * binary answers).
 *
 * Real-host finding: a `workspace-write` agent cannot `git commit` in a linked
 * worktree — the index lives under `<mainrepo>/.git/worktrees/<name>/`, outside
 * the DSH sandbox writable root. The HOST therefore commits the agent's
 * remaining changes at settlement (all outcomes), fail-soft, for single
 * worktrees and for every repo of a multi-repo mirror — without ever
 * committing structural `.dsh-worktrees`/nested-repo noise.
 *
 * @module dsh-taskboard/tests/worktree-autocommit
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createGitFace, worktreePathOf, type GitFace } from '../src/host/git.ts'
import { prepareMirror } from '../src/host/isolation.ts'
import { createRepoScanner } from '../src/host/repos.ts'
import { ExecutionService, type AgentsFace, type EventsFace } from '../src/host/execution.ts'
import { TaskStore } from '../src/host/store.ts'
import { TASKBOARD_PROTOCOL } from '../src/host/protocol-text.ts'
import { waitFor } from './wait-for.ts'
import type { TaskRecord } from '../src/shared/protocol.ts'

/** Run git in `cwd`; identity flags keep commits reproducible everywhere. */
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=agent@dsh.test', '-c', 'user.name=agent', ...args], { cwd, stdio: 'ignore' })
}

/** Git stdout in `cwd` (assertions only). */
function gitOut(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** Persist identity in the repo's local config so host git calls can commit. */
function initRepo(repo: string, files: Record<string, string> = { 'tracked.txt': 'initial\n' }): void {
  mkdirSync(repo, { recursive: true })
  git(repo, 'init', '-q')
  git(repo, 'config', 'user.email', 'agent@dsh.test')
  git(repo, 'config', 'user.name', 'agent')
  for (const [name, content] of Object.entries(files)) writeFileSync(join(repo, name), content)
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'init')
}

/** The contractual settlement commit message. */
function autoCommitMessage(taskId: string): string {
  return `taskboard: ${taskId} agent changes (auto-commit at settlement)`
}

/**
 * Wait until the git binary answers. On a loaded Windows CI box the very first
 * 2s-timeout probe can lose the race with process start/antivirus; retry a few
 * times so a transient miss is not mistaken for "no git installed".
 */
async function ensureGit(face: GitFace): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt++) {
    if (await face.binaryAvailable()) return
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error('git binary unavailable')
}

/** Prepare a real isolated mirror, retrying one transient "git unavailable" degrade. */
async function preparedMirror(face: GitFace, ws: string, taskId: string, branch: string) {
  await ensureGit(face)
  for (let attempt = 0; attempt < 2; attempt++) {
    const outcome = await prepareMirror({ git: face, scanner: createRepoScanner() }, {
      workspacePath: ws, taskId, branch, reuse: false,
    })
    if ('mirror' in outcome) return outcome.mirror
    if (attempt === 0 && /git 不可用/.test(outcome.note)) {
      await new Promise(resolve => setTimeout(resolve, 200))
      continue
    }
    throw new Error('expected a mirror: ' + outcome.note)
  }
  throw new Error('expected a mirror')
}

const gitAvailable = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const d = gitAvailable ? describe : describe.skip

d('worktree settlement auto-commit (0.10.2) on real git', () => {
  it('commits dirty single-worktree changes on the task branch, with the fixed host identity', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-atb-autocommit-single-'))
    try {
      const ws = join(base, 'ws')
      initRepo(ws)
      const face = createGitFace()
      const mirror = await preparedMirror(face, ws, 't-auto', 'task/auto+t-auto')
      const repo = mirror.repos[0]!
      // The agent's edits: one new file, one modified tracked file.
      writeFileSync(join(repo.worktreePath, 'agent-new.txt'), 'agent work\n')
      writeFileSync(join(repo.worktreePath, 'tracked.txt'), 'changed by agent\n')
      expect((await face.dirtyLines(repo.worktreePath))?.length).toBeGreaterThan(0)
      const before = gitOut(repo.worktreePath, 'rev-parse', 'HEAD')

      const result = await face.commitWorktree!(repo.worktreePath, repo.branch, autoCommitMessage('t-auto'))

      expect(result).toMatchObject({ outcome: 'committed' })
      expect(result.commit).toMatch(/^[0-9a-f]{7,40}$/)
      expect(await face.dirtyLines(repo.worktreePath)).toEqual([])
      expect(gitOut(repo.worktreePath, 'rev-parse', 'HEAD')).not.toBe(before)
      expect(gitOut(repo.worktreePath, 'log', '-1', '--pretty=%s')).toBe(autoCommitMessage('t-auto'))
      expect(gitOut(repo.worktreePath, 'log', '-1', '--pretty=%an <%ae>')).toBe('dsh-taskboard <taskboard@localhost>')
      // The branch itself advanced (the commit is on the task branch, not main).
      expect(gitOut(ws, 'log', '-1', '--pretty=%s', 'task/auto+t-auto')).toBe(autoCommitMessage('t-auto'))
      expect(readFileSync(join(repo.worktreePath, 'agent-new.txt'), 'utf8')).toBe('agent work\n')
    } finally { rmSync(base, { recursive: true, force: true, maxRetries: 3 }) }
  }, 30_000)

  it('does nothing in a clean worktree', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-atb-autocommit-clean-'))
    try {
      const ws = join(base, 'ws')
      initRepo(ws)
      const face = createGitFace()
      const mirror = await preparedMirror(face, ws, 't-clean', 'task/clean+t-clean')
      const repo = mirror.repos[0]!
      const before = gitOut(repo.worktreePath, 'rev-parse', 'HEAD')
      const result = await face.commitWorktree!(repo.worktreePath, repo.branch, autoCommitMessage('t-clean'))
      expect(result.outcome).toBe('clean')
      expect(gitOut(repo.worktreePath, 'rev-parse', 'HEAD')).toBe(before)
    } finally { rmSync(base, { recursive: true, force: true, maxRetries: 3 }) }
  }, 30_000)

  it('refuses to commit when the worktree is not on the task branch', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-atb-autocommit-branch-'))
    try {
      const ws = join(base, 'ws')
      initRepo(ws)
      const face = createGitFace()
      const mirror = await preparedMirror(face, ws, 't-branch', 'task/branch+t-branch')
      const repo = mirror.repos[0]!
      writeFileSync(join(repo.worktreePath, 'agent.txt'), 'x\n')
      const result = await face.commitWorktree!(repo.worktreePath, 'task/some-other-branch', autoCommitMessage('t-branch'))
      expect(result.outcome).toBe('branch-mismatch')
      expect((await face.dirtyLines(repo.worktreePath))?.length).toBeGreaterThan(0)
    } finally { rmSync(base, { recursive: true, force: true, maxRetries: 3 }) }
  }, 30_000)

  it('commits only the dirty repo of a mirror and never the nested-repo structural noise', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-atb-autocommit-mirror-'))
    try {
      const ws = join(base, 'ws')
      initRepo(ws, { 'README.md': 'root\n' })
      const sub = join(ws, 'sub-repo')
      initRepo(sub, { 'lib.txt': 'sub\n' })
      const face = createGitFace()
      const mirror = await preparedMirror(face, ws, 't-mirror', 'task/mirror+t-mirror')
      expect(mirror.repos.map(repo => repo.repo)).toEqual(['', 'sub-repo'])
      const rootRepo = mirror.repos[0]!
      const subRepo = mirror.repos[1]!
      const rootHead = gitOut(rootRepo.worktreePath, 'rev-parse', 'HEAD')
      // The root worktree's status now shows the nested child worktree as
      // untracked noise — structural, never the agent's work.
      expect(await face.dirtyLines(rootRepo.worktreePath)).toEqual(expect.arrayContaining([expect.stringContaining('sub-repo')]))

      // Root: noise only → clean, no commit, HEAD unchanged.
      const rootResult = await face.commitWorktree!(rootRepo.worktreePath, rootRepo.branch, autoCommitMessage('t-mirror'), ['sub-repo'])
      expect(rootResult.outcome).toBe('clean')
      expect(gitOut(rootRepo.worktreePath, 'rev-parse', 'HEAD')).toBe(rootHead)

      // Only the nested repo has real agent edits → only it commits.
      writeFileSync(join(subRepo.worktreePath, 'lib.txt'), 'changed by agent\n')
      const subResult = await face.commitWorktree!(subRepo.worktreePath, subRepo.branch, autoCommitMessage('t-mirror'))
      expect(subResult.outcome).toBe('committed')
      expect(await face.dirtyLines(subRepo.worktreePath)).toEqual([])
      // The root branch never advanced and the nested worktree was never
      // staged as a gitlink (structural noise stays untracked, uncommitted).
      expect(gitOut(rootRepo.worktreePath, 'rev-parse', 'HEAD')).toBe(rootHead)
      expect(gitOut(ws, 'rev-parse', 'task/mirror+t-mirror')).toBe(rootHead)
      expect(gitOut(rootRepo.worktreePath, 'ls-files', '--stage', 'sub-repo')).toBe('')
    } finally { rmSync(base, { recursive: true, force: true, maxRetries: 3 }) }
  }, 30_000)

  it('fails SOFT when a commit hook rejects the commit (never throws, work stays recoverable)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-atb-autocommit-hook-'))
    try {
      const ws = join(base, 'ws')
      initRepo(ws)
      const face = createGitFace()
      const mirror = await preparedMirror(face, ws, 't-hook', 'task/hook+t-hook')
      const repo = mirror.repos[0]!
      writeFileSync(join(repo.worktreePath, 'agent.txt'), 'agent work\n')
      const before = gitOut(repo.worktreePath, 'rev-parse', 'HEAD')
      // A rejecting pre-commit hook (same repo, shared hooks dir).
      writeFileSync(join(ws, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })

      const result = await face.commitWorktree!(repo.worktreePath, repo.branch, autoCommitMessage('t-hook'))

      expect(result.outcome).toBe('failed')
      expect(result.error?.length).toBeGreaterThan(0)
      expect(gitOut(repo.worktreePath, 'rev-parse', 'HEAD')).toBe(before)
      // The work is still there (staged, recoverable) — never lost.
      expect((await face.dirtyLines(repo.worktreePath))?.some(line => line.includes('agent.txt'))).toBe(true)
    } finally { rmSync(base, { recursive: true, force: true, maxRetries: 3 }) }
  }, 30_000)
})

// ---------------------------------------------------------------------------
// Settlement integration: automatic commit + durable execution evidence
// ---------------------------------------------------------------------------

/** Fake agents face with manual settlement triggers (idle = success, fail = turn failure). */
function fakeAgents(): AgentsFace & { idle(): void; fail(): void } {
  const idles: Array<() => void> = []
  const failures: Array<(error: Error) => void> = []
  return {
    idle: () => { for (const resolve of idles.splice(0)) resolve() },
    fail: () => { for (const reject of failures.splice(0)) reject(new Error('agent failed before quiescence')) },
    create: async (options: { sessionId: string }) => ({
      agent: {
        id: options.sessionId,
        followup: () => {},
        inject: () => {},
        whenIdle: () => new Promise<void>((resolve, reject) => {
          idles.push(resolve)
          failures.push(reject)
        }),
      },
      dispose: async () => {},
    }),
  } as never as AgentsFace & { idle(): void; fail(): void }
}

function fakeEvents(): EventsFace {
  return { onSessionEvent: () => () => {} }
}

/** Seed one worktree-isolated card. */
function taskRecord(id: string): TaskRecord {
  return {
    id,
    title: `auto-commit ${id}`,
    description: '',
    prompt: 'do the work',
    workspaceId: 'ws-a',
    urgency: 'normal',
    status: 'todo',
    blocked: false,
    isolation: 'worktree',
    execution: { mode: 'claim' },
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: { kind: 'user' },
    updatedBy: { kind: 'user' },
    comments: [],
    executions: [],
  }
}

d('settlement auto-commit evidence (0.10.2) on real git', () => {
  it('commits leftover agent changes at settlement, records autoCommitted and notes it', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-atb-autocommit-settle-'))
    try {
      const ws = join(base, 'ws')
      initRepo(ws)
      const store = new TaskStore({ file: join(base, 'ledger.json') })
      const task = taskRecord('t-settle')
      await store.mutate('task-created', ledger => { ledger.tasks.push(task); return [task] })
      const agents = fakeAgents()
      const face = createGitFace()
      await ensureGit(face)
      const service = new ExecutionService({
        store,
        agents,
        workspaces: { get: id => (id === 'ws-a' ? { id, path: ws } : undefined), attach: async () => {} },
        events: fakeEvents(),
        now: Date.now,
        git: face,
      })
      const run = await service.run('t-settle', 'manual')
      expect(run.ok).toBe(true)      // The agent "cannot commit" (sandbox): edits stay dirty when it goes idle.
      const worktree = worktreePathOf(ws, 't-settle')
      writeFileSync(join(worktree, 'agent-work.txt'), 'finished but uncommitted\n')
      agents.idle()
      await waitFor(() => store.get('t-settle')!.executions[0]!.outcome !== 'running', 15_000)

      const settled = store.get('t-settle')!
      const execution = settled.executions[0]!
      expect(execution.outcome).toBe('succeeded')
      expect(execution.autoCommitted).toEqual([''])
      expect(execution.autoCommitError).toBeUndefined()
      // Evidence collected AFTER the commit carries it as a real commit.
      expect(execution.commits?.[0]?.subject).toBe(autoCommitMessage('t-settle'))
      expect(gitOut(worktree, 'log', '-1', '--pretty=%s')).toBe(autoCommitMessage('t-settle'))
      expect(gitOut(worktree, 'log', '-1', '--pretty=%an <%ae>')).toBe('dsh-taskboard <taskboard@localhost>')
      expect(await face.dirtyLines(worktree)).toEqual([])
      // The settlement system note tells the reviewer the host saved the work.
      expect(settled.comments.some(comment => comment.body.includes('宿主已自动提交残留改动'))).toBe(true)
      service.dispose()
    } finally { rmSync(base, { recursive: true, force: true, maxRetries: 3 }) }
  }, 45_000)

  it('records a failed auto-commit in the evidence but still settles the execution', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-atb-autocommit-settle-fail-'))
    try {
      const ws = join(base, 'ws')
      initRepo(ws)
      // A rejecting hook makes the host commit fail after staging.
      writeFileSync(join(ws, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 })
      const store = new TaskStore({ file: join(base, 'ledger.json') })
      const task = taskRecord('t-settle-fail')
      await store.mutate('task-created', ledger => { ledger.tasks.push(task); return [task] })
      const agents = fakeAgents()
      const face = createGitFace()
      await ensureGit(face)
      const service = new ExecutionService({
        store,
        agents,
        workspaces: { get: id => (id === 'ws-a' ? { id, path: ws } : undefined), attach: async () => {} },
        events: fakeEvents(),
        now: Date.now,
        git: face,
      })
      const run = await service.run('t-settle-fail', 'manual')
      expect(run.ok).toBe(true)
      writeFileSync(join(worktreePathOf(ws, 't-settle-fail'), 'agent-work.txt'), 'uncommittable\n')
      agents.idle()
      await waitFor(() => store.get('t-settle-fail')!.executions[0]!.outcome !== 'running', 15_000)

      const settled = store.get('t-settle-fail')!
      const execution = settled.executions[0]!
      // Fail-soft: the execution still settled successfully; the failure is
      // recorded, not fatal, and the work is preserved.
      expect(execution.outcome).toBe('succeeded')
      expect(execution.autoCommitted).toBeUndefined()
      expect(execution.autoCommitError).toBeDefined()
      expect(settled.status).toBe('in_review')
      expect(settled.comments.some(comment => comment.body.includes('宿主自动提交残留改动失败'))).toBe(true)
      service.dispose()
    } finally { rmSync(base, { recursive: true, force: true, maxRetries: 3 }) }
  }, 45_000)

  it('auto-commits even for a FAILED outcome, so work is never stranded', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-atb-autocommit-settle-failed-'))
    try {
      const ws = join(base, 'ws')
      initRepo(ws)
      const store = new TaskStore({ file: join(base, 'ledger.json') })
      const task = taskRecord('t-settle-failed')
      await store.mutate('task-created', ledger => { ledger.tasks.push(task); return [task] })
      const agents = fakeAgents()
      const face = createGitFace()
      await ensureGit(face)
      const service = new ExecutionService({
        store,
        agents,
        workspaces: { get: id => (id === 'ws-a' ? { id, path: ws } : undefined), attach: async () => {} },
        events: fakeEvents(),
        now: Date.now,
        git: face,
      })
      expect((await service.run('t-settle-failed', 'manual')).ok).toBe(true)
      const worktree = worktreePathOf(ws, 't-settle-failed')
      writeFileSync(join(worktree, 'partial-work.txt'), 'work before the failure\n')
      agents.fail()
      await waitFor(() => store.get('t-settle-failed')!.executions[0]!.outcome !== 'running', 15_000)

      const settled = store.get('t-settle-failed')!
      const execution = settled.executions[0]!
      expect(execution.outcome).toBe('failed')
      expect(execution.autoCommitted).toEqual([''])
      expect(await face.dirtyLines(worktree)).toEqual([])
      expect(gitOut(worktree, 'log', '-1', '--pretty=%s')).toBe(autoCommitMessage('t-settle-failed'))
      expect(settled.status).toBe('todo')
      expect(settled.comments.some(comment => comment.body.includes('宿主已自动提交残留改动'))).toBe(true)
      service.dispose()
    } finally { rmSync(base, { recursive: true, force: true, maxRetries: 3 }) }
  }, 45_000)

  it('auto-commits even for a CANCELLED outcome, so work is never stranded', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-atb-autocommit-settle-cancelled-'))
    try {
      const ws = join(base, 'ws')
      initRepo(ws)
      const store = new TaskStore({ file: join(base, 'ledger.json') })
      const task = taskRecord('t-settle-cancelled')
      await store.mutate('task-created', ledger => { ledger.tasks.push(task); return [task] })
      const agents = fakeAgents()
      const face = createGitFace()
      await ensureGit(face)
      const service = new ExecutionService({
        store,
        agents,
        workspaces: { get: id => (id === 'ws-a' ? { id, path: ws } : undefined), attach: async () => {} },
        events: fakeEvents(),
        now: Date.now,
        git: face,
      })
      expect((await service.run('t-settle-cancelled', 'manual')).ok).toBe(true)
      const worktree = worktreePathOf(ws, 't-settle-cancelled')
      writeFileSync(join(worktree, 'wip.txt'), 'cancelled mid-work\n')
      expect((await service.cancel('t-settle-cancelled')).ok).toBe(true)
      await waitFor(() => store.get('t-settle-cancelled')!.executions[0]!.outcome !== 'running', 15_000)

      const settled = store.get('t-settle-cancelled')!
      const execution = settled.executions[0]!
      expect(execution.outcome).toBe('cancelled')
      expect(execution.autoCommitted).toEqual([''])
      expect(await face.dirtyLines(worktree)).toEqual([])
      expect(gitOut(worktree, 'log', '-1', '--pretty=%s')).toBe(autoCommitMessage('t-settle-cancelled'))
      expect(settled.status).toBe('todo')
      service.dispose()
    } finally { rmSync(base, { recursive: true, force: true, maxRetries: 3 }) }
  }, 45_000)

  it('documents the settlement auto-commit fallback in the agent protocol text', () => {
    expect(TASKBOARD_PROTOCOL).toMatch(/自动提交剩余改动/)
    expect(TASKBOARD_PROTOCOL).toContain('auto-commit at settlement')
  })
})
