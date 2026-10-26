import type { BoardPermission } from '@/lib/board-permission'

/**
 * Shared (Redis) cache for board access decisions, used by /api/internal/board-access.
 *
 * Every socket connect needs a decision, and computing one is up to six Supabase queries. This turns a
 * stampede (a deploy, an outage ending, a classroom joining at once) into one lookup per (user, board)
 * per window across ALL Worker instances, instead of one per instance.
 *
 *   fresh   short TTL; served without touching Supabase
 *   last    kept longer; served ONLY when Supabase can't answer, so a database outage doesn't lock every
 *           collaborator out of every board. The window is deliberately short because a revoked person
 *           could otherwise reconnect on stale data.
 */

export interface KV {
  get(key: string): Promise<unknown>
  set(key: string, value: string, opts: { ex: number }): Promise<unknown>
}

export interface AccessCacheOptions {
  freshSeconds?: number
  deniedSeconds?: number
  lastKnownSeconds?: number
}

type Entry = { p: BoardPermission | null }

export function createAccessCache(kv: KV | null, o: AccessCacheOptions = {}) {
  const fresh = o.freshSeconds ?? 30
  const denied = o.deniedSeconds ?? 5
  const lastKnown = o.lastKnownSeconds ?? 60 * 60
  const k = (board: string, user: string) => `access:${board}:${user}`

  const read = async (key: string): Promise<Entry | null> => {
    if (!kv) return null
    try {
      const v = await kv.get(key)
      const e = typeof v === 'string' ? JSON.parse(v) : v
      return e && typeof e === 'object' && 'p' in e ? (e as Entry) : null
    } catch {
      return null // the cache must never be the reason an access check fails
    }
  }

  return {
    async getFresh(board: string, user: string): Promise<Entry | null> {
      return read(k(board, user))
    },
    async getLastKnown(board: string, user: string): Promise<Entry | null> {
      return read(`${k(board, user)}:last`)
    },
    async put(board: string, user: string, permission: BoardPermission | null): Promise<void> {
      if (!kv) return
      const value = JSON.stringify({ p: permission } satisfies Entry)
      try {
        await Promise.all([
          kv.set(k(board, user), value, { ex: permission ? fresh : denied }),
          // Only remember grants for outages: never let a stale "no" lock someone out, and never bank a "no".
          permission ? kv.set(`${k(board, user)}:last`, value, { ex: lastKnown }) : Promise.resolve(),
        ])
      } catch {
        // best effort
      }
    },
  }
}
