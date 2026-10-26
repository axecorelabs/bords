import { DurableObject } from 'cloudflare:workers'

/**
 * Single global registry of who is online. MessagingHubs only talk to it on
 * their first connect / last disconnect, so it stays cold otherwise.
 */
export class PresenceRegistry extends DurableObject<Env> {
  setOnline(userId: string, online: boolean): void {
    if (online) this.ctx.storage.put(`u:${userId}`, Date.now())
    else this.ctx.storage.delete(`u:${userId}`)
  }

  async filterOnline(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return []
    const found = new Set<string>()
    // storage.get accepts at most 128 keys per call
    for (let i = 0; i < userIds.length; i += 128) {
      const chunk = userIds.slice(i, i + 128)
      const rows = await this.ctx.storage.get<number>(chunk.map((id) => `u:${id}`))
      for (const key of rows.keys()) found.add(key.slice(2))
    }
    return [...found]
  }
}
