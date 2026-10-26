import { DurableObject } from 'cloudflare:workers'

/**
 * "Who is online" is spread over PRESENCE_SHARDS registry objects, chosen by a hash of the user id.
 * One global object would have to absorb every connect and disconnect from every user; sharding turns
 * that into 1/16th each. A lookup for someone's contacts fans out to at most that many shards in parallel.
 *
 * An entry records WHEN the user was last confirmed online. A messaging hub refreshes it periodically
 * while its sockets are open, and lookups ignore entries older than the TTL, so a hub that died without
 * reporting its disconnect can't leave someone shown as online forever.
 */

export const PRESENCE_SHARDS = 16
export const DEFAULT_ONLINE_TTL_MS = 12 * 60 * 60 * 1000

/** FNV-1a: small, fast and well spread for short ids. */
export function presenceShard(userId: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0) % PRESENCE_SHARDS
}

export function presenceStub(env: Env, userId: string) {
  return env.PRESENCE.get(env.PRESENCE.idFromName(`shard:${presenceShard(userId)}`))
}

/** Which of these users are online? One parallel lookup per shard that holds any of them. */
export async function filterOnlineAcrossShards(env: Env, userIds: string[]): Promise<string[]> {
  const byShard = new Map<number, string[]>()
  for (const id of userIds) {
    const shard = presenceShard(id)
    const list = byShard.get(shard)
    if (list) list.push(id)
    else byShard.set(shard, [id])
  }
  const results = await Promise.all(
    [...byShard.entries()].map(([shard, ids]) =>
      env.PRESENCE.get(env.PRESENCE.idFromName(`shard:${shard}`)).filterOnline(ids)
    )
  )
  return results.flat()
}

export class PresenceRegistry extends DurableObject<Env> {
  setOnline(userId: string, online: boolean): void {
    if (online) this.ctx.storage.put(`u:${userId}`, Date.now())
    else this.ctx.storage.delete(`u:${userId}`)
  }

  async filterOnline(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return []
    const ttl = Number(this.env.PRESENCE_ONLINE_TTL_MS) || DEFAULT_ONLINE_TTL_MS
    const now = Date.now()
    const found: string[] = []
    // storage.get accepts at most 128 keys per call
    for (let i = 0; i < userIds.length; i += 128) {
      const chunk = userIds.slice(i, i + 128)
      const rows = await this.ctx.storage.get<number>(chunk.map((id) => `u:${id}`))
      for (const [key, seenAt] of rows) if (now - seenAt < ttl) found.push(key.slice(2))
    }
    return found
  }
}
