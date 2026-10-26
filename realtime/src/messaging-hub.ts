import { DurableObject } from 'cloudflare:workers'
import { loadConversationPeers } from './supabase'
import { filterOnlineAcrossShards, presenceStub } from './presence-registry'

/** Subprotocol the browser offers; the ticket rides along as a second entry. */
export const MESSAGING_PROTOCOL = 'bords-messaging'

const MAX_SUBSCRIPTIONS = 200
/** A person's contacts rarely change; reuse the list instead of asking Supabase on every connect. */
const PEERS_TTL_MS = 10 * 60 * 1000
/** While sockets are open, re-confirm "online" this often (registry entries expire; see presence-registry.ts). */
const DEFAULT_REFRESH_MS = 6 * 60 * 60 * 1000
/** Bump when the registry layout changes: hubs re-register themselves the next time they wake. */
const PRESENCE_VERSION = 2

interface SocketAttachment {
  userId: string
  subs: string[]
}

export interface DeliverEvent {
  type: 'new_message' | 'update_message'
  conversationId: string
  senderId?: string
  payload: Record<string, unknown>
}

/**
 * One Durable Object per user, holding all of that user's messaging sockets
 * (one per tab). Events are pushed to it by the front Worker's /messaging/emit.
 *
 * Idle sockets cost nothing: the client sends a text "ping" which the runtime
 * answers with "pong" without waking the object, so it can hibernate.
 */
export class MessagingHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    const userId = request.headers.get('x-bords-user-id')
    if (!userId || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected authenticated WebSocket upgrade', { status: 400 })
    }

    const { 0: client, 1: server } = new WebSocketPair()
    const first = this.#openSockets().length === 0
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ userId, subs: [] } satisfies SocketAttachment)
    server.send(JSON.stringify({ type: 'connected', userId }))

    if (first) {
      this.ctx.waitUntil(this.#announce(userId, true, server))
      this.ctx.waitUntil(this.#armRefresh())
    } else {
      this.ctx.waitUntil(this.#sendPresenceSnapshot(userId, server))
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { 'Sec-WebSocket-Protocol': MESSAGING_PROTOCOL },
    })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    this.ctx.waitUntil(this.#ensureRegistered())
    if (typeof message !== 'string') return
    let msg: { type?: string; conversationId?: unknown }
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    const att = ws.deserializeAttachment() as SocketAttachment | null
    if (!att) return

    if (typeof msg.conversationId === 'string' && msg.conversationId) {
      const subs = new Set(att.subs)
      if (msg.type === 'subscribe_conversation' && subs.size < MAX_SUBSCRIPTIONS) {
        subs.add(msg.conversationId)
        ws.send(JSON.stringify({ type: 'subscribed', conversationId: msg.conversationId }))
      } else if (msg.type === 'unsubscribe_conversation') {
        subs.delete(msg.conversationId)
      } else {
        return
      }
      ws.serializeAttachment({ ...att, subs: [...subs] } satisfies SocketAttachment)
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code === 1005 ? 1000 : code, reason)
    } catch {
      // already closed
    }
    await this.#afterSocketGone(ws)
  }

  async webSocketError(ws: WebSocket) {
    await this.#afterSocketGone(ws)
  }

  // ── RPC (called by the front Worker / other hubs) ─────────────────────────

  /** Fan an event out to this user's sockets. Returns how many sockets got something. */
  deliver(event: DeliverEvent, isSender: boolean): number {
    this.ctx.waitUntil(this.#ensureRegistered())
    let sent = 0
    for (const ws of this.#openSockets()) {
      const att = ws.deserializeAttachment() as SocketAttachment | null
      if (!att) continue
      const subscribed = att.subs.includes(event.conversationId)

      if (subscribed) {
        ws.send(JSON.stringify({ type: event.type, payload: event.payload }))
        sent += 1
      }
      // Everyone but the sender also gets a badge update so unread counts and
      // toasts work from any page, even when the conversation is open.
      if (event.type === 'new_message' && !isSender) {
        const p = event.payload
        ws.send(
          JSON.stringify({
            type: 'badge_update',
            conversationId: event.conversationId,
            lastMessage: {
              id: p.id,
              content: p.content ?? null,
              senderId: p.sender_id,
              senderName: p.sender_name ?? '',
              createdAt: p.created_at,
            },
            updatedAt: p.created_at,
          })
        )
        sent += 1
      }
    }
    return sent
  }

  /** Something in this user's notifications changed; clients refetch. */
  notificationChanged(): number {
    const msg = JSON.stringify({ type: 'notification_change' })
    const sockets = this.#openSockets()
    for (const ws of sockets) ws.send(msg)
    return sockets.length
  }

  /** A peer came online/offline. */
  presence(userId: string, online: boolean): void {
    const msg = JSON.stringify({ type: 'presence_update', userId, online })
    for (const ws of this.#openSockets()) ws.send(msg)
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  #openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN)
  }

  async #afterSocketGone(ws: WebSocket) {
    const att = ws.deserializeAttachment() as SocketAttachment | null
    if (!att) return
    const stillOpen = this.#openSockets().filter((w) => w !== ws)
    if (stillOpen.length === 0) await this.#announce(att.userId, false)
  }

  /** Contacts (people sharing a conversation), cached in this object's storage. */
  async #peers(userId: string): Promise<string[]> {
    const cached = await this.ctx.storage.get<{ at: number; ids: string[] }>('peers')
    if (cached && Date.now() - cached.at < PEERS_TTL_MS) return cached.ids
    const ids = await loadConversationPeers(this.env, userId)
    await this.ctx.storage.put('peers', { at: Date.now(), ids })
    return ids
  }

  /** First tab opened / last tab closed: update the registry and tell online peers. */
  async #announce(userId: string, online: boolean, newSocket?: WebSocket) {
    try {
      await presenceStub(this.env, userId).setOnline(userId, online)
      if (online) await this.ctx.storage.put('presenceV', PRESENCE_VERSION)

      const peers = await this.#peers(userId)
      const onlinePeers = await filterOnlineAcrossShards(this.env, peers)

      if (newSocket) {
        for (const peerId of onlinePeers) {
          newSocket.send(JSON.stringify({ type: 'presence_update', userId: peerId, online: true }))
        }
      }
      await Promise.allSettled(
        onlinePeers.map((peerId) =>
          this.env.MESSAGING_HUB.get(this.env.MESSAGING_HUB.idFromName(peerId)).presence(userId, online)
        )
      )
    } catch (err) {
      // Presence is best-effort; never take down messaging over it.
      console.warn('presence announce failed:', err)
    }
  }

  /** Extra tab opened while already online: just catch it up on who else is online. */
  async #sendPresenceSnapshot(userId: string, socket: WebSocket) {
    try {
      const peers = await this.#peers(userId)
      for (const peerId of await filterOnlineAcrossShards(this.env, peers)) {
        socket.send(JSON.stringify({ type: 'presence_update', userId: peerId, online: true }))
      }
    } catch (err) {
      console.warn('presence snapshot failed:', err)
    }
  }

  // ── Keeping the registry honest ───────────────────────────────────────────

  get #refreshMs() {
    return Number(this.env.PRESENCE_REFRESH_MS) || DEFAULT_REFRESH_MS
  }

  async #armRefresh() {
    await this.ctx.storage.setAlarm(Date.now() + this.#refreshMs)
  }

  /** While anyone is connected, keep this user's registry entry fresh so it doesn't expire. */
  async alarm() {
    const sockets = this.#openSockets()
    if (sockets.length === 0) return
    const att = sockets[0].deserializeAttachment() as SocketAttachment | null
    if (!att) return
    try {
      await presenceStub(this.env, att.userId).setOnline(att.userId, true)
    } catch (err) {
      console.warn('presence refresh failed:', err)
    }
    await this.#armRefresh()
  }

  /**
   * A hub that is already connected when the registry layout changes (or whose entry was lost) is not
   * re-announced by anything, since idle hubs sleep. The first time one wakes it re-registers itself.
   */
  async #ensureRegistered() {
    const sockets = this.#openSockets()
    if (sockets.length === 0) return
    if ((await this.ctx.storage.get<number>('presenceV')) === PRESENCE_VERSION) return
    const att = sockets[0].deserializeAttachment() as SocketAttachment | null
    if (!att) return
    try {
      await presenceStub(this.env, att.userId).setOnline(att.userId, true)
      await this.ctx.storage.put('presenceV', PRESENCE_VERSION)
      await this.#armRefresh()
    } catch (err) {
      console.warn('presence re-register failed:', err)
    }
  }
}
