/**
 * messaging-socket.ts
 *
 * Singleton WebSocket client for the collab-server messaging layer.
 *
 * Usage:
 *   import { messagingSocket } from '@/lib/messaging-socket'
 *
 *   // Start the connection (call once, e.g. from a top-level effect)
 *   messagingSocket.connect()
 *
 *   // Subscribe to a conversation room
 *   messagingSocket.subscribeToConversation(id)
 *
 *   // Listen for events
 *   const off = messagingSocket.on((event) => { ... })
 *   // later: off()
 *
 *   // Clean up (e.g. on sign-out)
 *   messagingSocket.destroy()
 *
 * Reconnect strategy:
 *   Exponential backoff starting at 1s, capped at 30s, with ±20% jitter.
 *   Reconnects re-subscribe to all previously active conversations.
 *
 * Auth:
 *   Fetches a short-lived ticket from /api/collab/ticket on each (re)connect.
 *   The ticket is a JWE with 5-min expiry — only used for the WS handshake.
 */

export type MessagingSocketEvent =
  | { type: 'connected'; userId: string }
  | { type: 'subscribed'; conversationId: string }
  | { type: 'new_message'; payload: Record<string, unknown> }
  | { type: 'update_message'; payload: Record<string, unknown> }
  | {
      type: 'badge_update'
      conversationId: string
      lastMessage?: {
        id: string
        content: string | null
        senderId: string
        senderName: string
        createdAt: string
      }
      updatedAt?: string
    }
  | { type: 'presence_update'; userId: string; online: boolean }
  | { type: 'error'; code: string; conversationId?: string }

type EventHandler = (event: MessagingSocketEvent) => void

const WS_URL = (process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? 'ws://localhost:4444')
  .replace(/\/$/, '')

const MIN_DELAY = 1_000
const MAX_DELAY = 30_000
// If no message from server for this long, consider the connection dead and reconnect.
// Must be > server ping interval (25s) to avoid false positives.
const PONG_TIMEOUT_MS = 55_000

function jitter(ms: number): number {
  return ms * (0.8 + Math.random() * 0.4) // ±20%
}

class MessagingSocketClient {
  private ws: WebSocket | null = null
  private handlers = new Set<EventHandler>()

  /** Conversations we want to stay subscribed to across reconnects */
  private activeConversations = new Set<string>()

  private connected = false
  private destroyed = false
  private reconnectDelay = MIN_DELAY
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null

  // ── Public API ────────────────────────────────────────────────────────────

  /** Open the WebSocket connection. Safe to call multiple times. */
  connect(): void {
    if (this.destroyed || this.ws) return
    this._open()
  }

  /** Subscribe to live events for a conversation room. */
  subscribeToConversation(conversationId: string): void {
    this.activeConversations.add(conversationId)
    if (this.connected) {
      this._send({ type: 'subscribe_conversation', conversationId })
    }
  }

  /** Unsubscribe from a conversation room. */
  unsubscribeFromConversation(conversationId: string): void {
    this.activeConversations.delete(conversationId)
    if (this.connected) {
      this._send({ type: 'unsubscribe_conversation', conversationId })
    }
  }

  /**
   * Register a handler for all incoming server events.
   * Returns an unsubscribe function.
   */
  on(handler: EventHandler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /** Permanently close the connection and stop reconnecting. */
  destroy(): void {
    this.destroyed = true
    this._clearReconnectTimer()
    this._clearPongTimer()
    this.ws?.close()
    this.ws = null
    this.connected = false
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private async _open(): Promise<void> {
    if (this.destroyed) return

    let ticket = ''
    try {
      const res = await fetch('/api/collab/ticket', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        ticket = data.ticket ?? ''
      }
    } catch {
      // Auth service unavailable — schedule retry
      this._scheduleReconnect()
      return
    }

    if (!ticket) {
      this._scheduleReconnect()
      return
    }

    // Connect without the token in the URL — the ticket is sent as the
    // very first WebSocket message ({ type: 'auth', token }) so it never
    // appears in server access logs, browser history, or proxy logs.
    const url = `${WS_URL}/messaging`

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    } catch {
      this._scheduleReconnect()
      return
    }

    this.ws = ws

    ws.onopen = () => {
      // Send auth as the first message so the token never appears in the URL.
      ws.send(JSON.stringify({ type: 'auth', token: ticket }))
      // Wait for the 'connected' server ack before marking as connected.
    }

    ws.onmessage = (event) => {
      // Any message from the server means the connection is alive — reset watchdog
      this._resetPongTimer()

      let parsed: MessagingSocketEvent
      try {
        parsed = JSON.parse(event.data as string) as MessagingSocketEvent
      } catch {
        return
      }

      if (parsed.type === 'connected') {
        this.connected = true
        this.reconnectDelay = MIN_DELAY // reset backoff on successful connect

        // Re-subscribe to all tracked conversations
        for (const id of this.activeConversations) {
          this._send({ type: 'subscribe_conversation', conversationId: id })
        }
      }

      // Dispatch to all registered handlers
      for (const handler of this.handlers) {
        try { handler(parsed) } catch { /* isolate handler errors */ }
      }
    }

    ws.onerror = () => {
      // onerror is always followed by onclose — handle there
    }

    ws.onclose = (ev) => {
      this.connected = false
      this.ws = null
      this._clearPongTimer()

      if (this.destroyed) return

      // 4001 = auth rejected — don't retry with same creds,
      // but the next reconnect will fetch a fresh ticket anyway
      if (ev.code === 4001) {
        // Back off longer on auth failure
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_DELAY)
      }

      this._scheduleReconnect()
    }
  }

  private _send(msg: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private _resetPongTimer(): void {
    this._clearPongTimer()
    this.pongTimer = setTimeout(() => {
      // No message received in PONG_TIMEOUT_MS — connection is silently dead
      console.warn('[MessagingSocket] pong timeout — reconnecting')
      this.ws?.close()
      // onclose will handle reconnect
    }, PONG_TIMEOUT_MS)
  }

  private _clearPongTimer(): void {
    if (this.pongTimer !== null) {
      clearTimeout(this.pongTimer)
      this.pongTimer = null
    }
  }

  private _scheduleReconnect(): void {    if (this.destroyed) return
    this._clearReconnectTimer()
    const delay = jitter(this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, MAX_DELAY)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._open()
    }, delay)
  }

  private _clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

/** Module-level singleton — one connection shared across the whole app. */
export const messagingSocket = new MessagingSocketClient()
