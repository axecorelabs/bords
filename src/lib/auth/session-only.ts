import { betterAuth } from 'better-auth'
import { createBaseOptions } from './base-options'

/**
 * Session validation only: same database, cookies and session settings as the
 * full instance in server.ts, but no email, social or hook code. The proxy
 * (middleware) uses this because its bundle can't carry react-email.
 * Sessions it reads are identical to the ones `auth` issues.
 *
 * Built lazily on first use: the proxy bundle evaluates before Workers populates
 * process.env, so constructing at import time would capture an undefined secret.
 */
let instance: ReturnType<typeof create> | null = null

function create() {
  return betterAuth(createBaseOptions())
}

export function getSessionAuth() {
  return (instance ??= create())
}
