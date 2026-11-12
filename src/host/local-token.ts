/**
 * Zero-configuration token for the Agent Board public contract.
 *
 * Both plugins run inside the same DSH host for the same OS user, so asking the
 * operator to mint and export a secret is pure friction. Resolution order:
 *   1. `DSH_TASKBOARD_PUBLIC_TOKEN` (explicit operator value, unchanged)
 *   2. `$DSH_HOME/taskboard/public-api.token` (created once, mode 0600)
 * The API stays bearer-authenticated and loopback-served; the file is readable
 * only by the user who already owns the ledger itself.
 *
 * @module dsh-taskboard/host/local-token
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { dshHomePath } from './sdk.ts'
import { PUBLIC_API_TOKEN_ENV } from '../shared/public-api.ts'

export const LOCAL_TOKEN_SEGMENTS = ['taskboard', 'public-api.token'] as const

export function localTokenPath(): string {
  return dshHomePath(...LOCAL_TOKEN_SEGMENTS)
}

function readTokenFile(path: string): string | undefined {
  try {
    const text = readFileSync(path, 'utf8').trim()
    return text.length >= 32 ? text : undefined
  } catch {
    return undefined
  }
}

/** Returns the effective token, creating the local file on first use. */
export function resolvePublicToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const explicit = env[PUBLIC_API_TOKEN_ENV]?.trim()
  if (explicit !== undefined && explicit.length > 0) return explicit
  if (env.DSH_TASKBOARD_PUBLIC_TOKEN_DISABLE_LOCAL === '1') return undefined
  const path = localTokenPath()
  const existing = readTokenFile(path)
  if (existing !== undefined) return existing
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, randomBytes(32).toString('hex'), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  } catch (error) {
    // `wx` lost a race with another host: the winner's file is authoritative.
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      console.warn('[dsh-taskboard] local public token unavailable:', error)
      return undefined
    }
  }
  return readTokenFile(path)
}
