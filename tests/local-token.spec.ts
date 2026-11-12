import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { localTokenPath, resolvePublicToken } from '../src/host/local-token.ts'

describe('local public token', () => {
  let home: string
  const previous = process.env.DSH_HOME
  beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'tb-token-')); process.env.DSH_HOME = home })
  afterEach(() => { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous; rmSync(home, { recursive: true, force: true }) })

  it('prefers the explicit environment token and writes nothing', () => {
    expect(resolvePublicToken({ DSH_TASKBOARD_PUBLIC_TOKEN: 'explicit-token' })).toBe('explicit-token')
    expect(() => readFileSync(localTokenPath())).toThrow()
  })
  it('creates one stable 64-hex token on first use', () => {
    const first = resolvePublicToken({})
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(resolvePublicToken({})).toBe(first)
    expect(readFileSync(join(home, 'taskboard', 'public-api.token'), 'utf8')).toBe(first)
  })
  it('keeps an existing file and can be disabled', () => {
    resolvePublicToken({})
    writeFileSync(localTokenPath(), 'a'.repeat(40))
    expect(resolvePublicToken({})).toBe('a'.repeat(40))
    expect(resolvePublicToken({ DSH_TASKBOARD_PUBLIC_TOKEN_DISABLE_LOCAL: '1' })).toBeUndefined()
  })
})
