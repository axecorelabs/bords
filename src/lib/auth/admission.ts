/**
 * Admission control for the expensive part of auth (password hashing, ~0.35 s of CPU each).
 *
 * Two independent limits, both checked BEFORE any hashing so a refused attempt costs almost nothing:
 *   - per account: a burst of guesses at one email (credential stuffing from many IPs gets past the
 *     per-IP limit, but not this one). A successful sign-in clears the account's counter.
 *   - global: at most N hashes per second across the whole app, so a flood degrades into "try again in a
 *     few seconds" instead of ever-growing queues and cost. Normal traffic is nowhere near it.
 *
 * Counters live in Redis (shared by every Worker instance). If Redis is down it ADMITS: a limiter outage
 * must not lock everyone out.
 */

export interface CounterStore {
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<unknown>
  del(key: string): Promise<unknown>
}

export class AdmissionError extends Error {
  constructor(
    message: string,
    readonly retryAfterSeconds: number
  ) {
    super(message)
  }
}

interface Options {
  /** Wrong-password / any attempts allowed per account per window. */
  perAccountMax?: number
  perAccountWindowSeconds?: number
  /** Password hashes per second across the app. */
  globalPerSecond?: number
  now?: () => number
}

export function createAdmission(store: CounterStore | null, opts: Options = {}) {
  const perAccountMax = opts.perAccountMax ?? 10
  const perAccountWindow = opts.perAccountWindowSeconds ?? 15 * 60
  const globalPerSecond = opts.globalPerSecond ?? 60
  const now = opts.now ?? (() => Date.now())

  async function bump(key: string, windowSeconds: number): Promise<number> {
    const n = await store!.incr(key)
    if (n === 1) await store!.expire(key, windowSeconds)
    return n
  }

  return {
    /** Throws AdmissionError if this sign-in attempt should be refused. */
    async checkSignIn(emailKey: string): Promise<void> {
      if (!store) return
      try {
        const account = await bump(`auth:acct:${emailKey}`, perAccountWindow)
        if (account > perAccountMax) {
          throw new AdmissionError('Too many sign-in attempts for this account. Please wait a few minutes and try again.', perAccountWindow)
        }
        await this.checkGlobal()
      } catch (err) {
        if (err instanceof AdmissionError) throw err
        console.error('[auth] admission check failed open:', err)
      }
    },

    /** Any password work (sign-in, sign-up, reset): is the app under its hashing budget this second? */
    async checkGlobal(): Promise<void> {
      if (!store) return
      try {
        const second = Math.floor(now() / 1000)
        const n = await bump(`auth:hash:${second}`, 5)
        if (n > globalPerSecond) {
          throw new AdmissionError('We are seeing a lot of sign-ins right now. Please try again in a few seconds.', 3)
        }
      } catch (err) {
        if (err instanceof AdmissionError) throw err
        console.error('[auth] global admission check failed open:', err)
      }
    },

    /** A successful sign-in forgives earlier typos. */
    async clearAccount(emailKey: string): Promise<void> {
      if (!store) return
      try {
        await store.del(`auth:acct:${emailKey}`)
      } catch {
        // best effort
      }
    },
  }
}

/** Stable, non-reversible key for an email (never put raw emails in Redis keys). */
export async function emailKey(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}
