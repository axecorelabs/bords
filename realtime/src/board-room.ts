import { YServer } from 'y-partyserver'
import type { Connection, ConnectionContext } from 'partyserver'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import { loadYDoc, saveYDoc } from './supabase'

export type BoardPermission = 'owner' | 'edit' | 'view'

/** Identity the front Worker attaches after verifying the ticket and checking board access. */
export const IDENTITY_HEADERS = {
  userId: 'x-bords-user-id',
  name: 'x-bords-user-name',
  email: 'x-bords-user-email',
  permission: 'x-bords-permission',
} as const

interface ConnState {
  userId?: string
  name?: string
  email?: string
  permission?: BoardPermission
  connectedAt?: string
}

/** Awareness client ids a connection controls (y-partyserver records them in the connection's state). */
function awarenessIdsOf(connection: Connection): number[] {
  try {
    return ((connection.state as Record<string, unknown> | null)?.__ypsAwarenessIds as number[] | undefined) ?? []
  } catch {
    return []
  }
}

/**
 * One Durable Object per board. Holds the live Y.Doc, speaks the y-websocket
 * protocol (sync + awareness) over hibernatable WebSockets, and persists to the
 * existing `yjs_documents` table so the REST save path, the projection cron and
 * AI indexing keep reading the same source.
 */
export class BoardRoom extends YServer {
  static options = { hibernate: true }
  static callbackOptions = { debounceWait: 1500, debounceMaxWait: 8000 }

  #version = 0
  #dirty = false
  #lastEditor: string | null = null
  #lastSaveAt = 0

  /** Retry delay after a failed save, and the minimum gap between saves of a big board. */
  static RETRY_MS = 5_000
  static BIG_DOC_BYTES = 1_000_000
  static BIG_DOC_MIN_GAP_MS = 15_000
  /** Past this many journal rows (Supabase unreachable for a long time) they are compacted into one snapshot. */
  static JOURNAL_MAX_ROWS = 2_000

  // ── Awareness (cursors, selections, presence) fan-out ──
  // y-partyserver relays every awareness update to every connection the moment it arrives. With n
  // people each sending r updates/s that is n·r·(n-1) outgoing messages/s, which grows with the
  // SQUARE of the room: a 20-person room at 10 updates/s each needs ~3,800 sends/s, more than one
  // Durable Object can push (it falls behind and everyone's cursors lag by seconds).
  // Instead, small rooms still relay immediately, and bigger ones collect changes for a short window
  // and send ONE combined update per connection per window, so outgoing traffic grows with n, not n².
  static AWARENESS_IMMEDIATE_UP_TO = 6
  static AWARENESS_BATCH_MS = 40
  #awarenessQueued = new Set<number>()
  #awarenessTimer: ReturnType<typeof setTimeout> | null = null

  handleMessage(connection: Connection, message: string | ArrayBuffer | ArrayBufferView) {
    if (typeof message !== 'string' && this.#getConnectionCount() > BoardRoom.AWARENESS_IMMEDIATE_UP_TO) {
      const bytes =
        message instanceof Uint8Array
          ? message
          : message instanceof ArrayBuffer
            ? new Uint8Array(message)
            : new Uint8Array((message as ArrayBufferView).buffer, (message as ArrayBufferView).byteOffset, (message as ArrayBufferView).byteLength)
      const decoder = decoding.createDecoder(bytes)
      if (decoding.readVarUint(decoder) === 1 /* messageAwareness */) {
        try {
          const changed = new Set<number>()
          const collect = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
            if (origin === connection) for (const id of [...added, ...updated, ...removed]) changed.add(id)
          }
          const awareness = this.document.awareness
          awareness.on('update', collect)
          try {
            awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), connection)
          } finally {
            awareness.off('update', collect)
          }
          for (const id of changed) this.#awarenessQueued.add(id)
          this.#awarenessTimer ??= setTimeout(() => this.#flushAwareness(), BoardRoom.AWARENESS_BATCH_MS)
        } catch (err) {
          console.error('awareness batch error:', err)
        }
        return
      }
    }
    return super.handleMessage(connection, message as any)
  }

  #flushAwareness() {
    this.#awarenessTimer = null
    if (this.#awarenessQueued.size === 0) return
    const ids = [...this.#awarenessQueued]
    this.#awarenessQueued.clear()
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, 1 /* messageAwareness */)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.document.awareness, ids))
    const packet = encoding.toUint8Array(encoder)
    for (const conn of this.getConnections()) {
      try {
        conn.send(packet)
      } catch {
        // socket already closing
      }
    }
  }

  // Counting connections walks every socket, so don't do it per message: a stale count by a few
  // hundred ms only means switching between immediate and batched relay slightly late.
  #connCount = 0
  #connCountAt = 0
  #getConnectionCount(): number {
    const now = Date.now()
    if (now - this.#connCountAt > 500) {
      let n = 0
      for (const _ of this.getConnections()) n++
      this.#connCount = n
      this.#connCountAt = now
    }
    return this.#connCount
  }

  get #sql() {
    return this.ctx.storage.sql
  }

  async onStart() {
    // Every accepted edit is also appended to this object's own SQLite storage. Supabase gets a
    // full snapshot every few seconds, but an edit made in the gap (or while Supabase is down) lives
    // here, so it survives eviction, restarts and outages. The journal is trimmed after each
    // successful save, and replayed on top of the saved snapshot when the object starts.
    this.#sql.exec('CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)')

    await super.onStart() // runs onLoad() and wires the sync/awareness handlers

    this.document.on('update', (update: Uint8Array, origin: unknown) => {
      this.#dirty = true
      const editor = (origin as Connection<ConnState> | null)?.state?.userId
      if (editor) this.#lastEditor = editor
      this.#journalAppend(update)
    })

    // Edits that were journalled but never reached Supabase before this object last stopped.
    if (this.#journalRows() > 0) {
      this.#dirty = true
      await this.ctx.storage.setAlarm(Date.now() + 1_000)
    }
  }

  // Throws on a Supabase outage on purpose: starting from an empty document and
  // later saving it would overwrite the real one.
  async onLoad() {
    const { state, version } = await loadYDoc(this.env, this.name)
    this.#version = version
    const doc = new Y.Doc()
    if (state) Y.applyUpdate(doc, state)
    // Replay edits that the last saved snapshot doesn't have yet (Yjs updates are idempotent).
    for (const row of this.#sql.exec('SELECT data FROM journal ORDER BY id')) {
      Y.applyUpdate(doc, new Uint8Array(row.data as ArrayBuffer))
    }
    return state || this.#journalRows() > 0 ? doc : undefined
  }

  async onSave(force = false) {
    if (!this.#dirty) return
    const state = Y.encodeStateAsUpdate(this.document)

    // Big boards: a full snapshot is a lot to write. The journal already protects the edits, so
    // space the snapshots out (unless this is the final flush as the last person leaves).
    if (!force && state.byteLength > BoardRoom.BIG_DOC_BYTES) {
      const wait = this.#lastSaveAt + BoardRoom.BIG_DOC_MIN_GAP_MS - Date.now()
      if (wait > 0) {
        await this.ctx.storage.setAlarm(Date.now() + wait)
        return
      }
    }

    this.#dirty = false
    const journalUpTo = this.#journalMaxId() // everything journalled so far is inside `state`
    try {
      const stateVector = Y.encodeStateVector(this.document)
      this.#version += 1
      await saveYDoc(this.env, this.name, state, stateVector, this.#version, this.#lastEditor)
      this.#lastSaveAt = Date.now()
      this.#sql.exec('DELETE FROM journal WHERE id <= ?', journalUpTo)
      this.#notifyDirty()
    } catch (err) {
      this.#dirty = true
      this.#version -= 1
      // Don't wait for the next edit: try again shortly, even if nobody is connected any more.
      await this.ctx.storage.setAlarm(Date.now() + BoardRoom.RETRY_MS)
      throw err
    }
  }

  async onAlarm() {
    if (!this.#dirty) return
    await this.onSave(true).catch((err) => console.error('retry save failed:', err))
  }

  #journalAppend(update: Uint8Array) {
    const copy = update.buffer.slice(update.byteOffset, update.byteOffset + update.byteLength)
    this.#sql.exec('INSERT INTO journal (data) VALUES (?)', copy)
    if (this.#journalRows() > BoardRoom.JOURNAL_MAX_ROWS) this.#journalCompact()
  }

  /** Replace the whole journal with one snapshot of the current document. */
  #journalCompact() {
    const snapshot = Y.encodeStateAsUpdate(this.document)
    const copy = snapshot.buffer.slice(snapshot.byteOffset, snapshot.byteOffset + snapshot.byteLength)
    this.ctx.storage.transactionSync(() => {
      this.#sql.exec('DELETE FROM journal')
      this.#sql.exec('INSERT INTO journal (data) VALUES (?)', copy)
    })
  }

  #journalRows(): number {
    return (this.#sql.exec('SELECT COUNT(*) AS n FROM journal').one().n as number) ?? 0
  }

  #journalMaxId(): number {
    return (this.#sql.exec('SELECT COALESCE(MAX(id), 0) AS m FROM journal').one().m as number) ?? 0
  }

  isReadOnly(connection: Connection) {
    return (connection.state as ConnState | null)?.permission === 'view'
  }

  onConnect(connection: Connection, ctx: ConnectionContext) {
    const h = ctx.request.headers
    const userId = h.get(IDENTITY_HEADERS.userId)
    const permission = h.get(IDENTITY_HEADERS.permission) as BoardPermission | null
    if (!userId || !permission) {
      // Only the front Worker should ever reach this DO; it always sets identity.
      connection.close(4001, 'unauthorized')
      return
    }
    connection.setState((prev: unknown) => ({
      ...(prev as ConnState | null),
      userId,
      name: h.get(IDENTITY_HEADERS.name) ?? '',
      email: h.get(IDENTITY_HEADERS.email) ?? '',
      permission,
      connectedAt: new Date().toISOString(),
    }))
    return super.onConnect(connection, ctx)
  }

  async onClose(connection: Connection, code: number, reason: string, wasClean: boolean) {
    super.onClose(connection, code, reason, wasClean)
    // Last one out flushes immediately instead of waiting for the debounce.
    const remaining = [...this.getConnections()].filter((c) => c.id !== connection.id)
    if (remaining.length === 0 && this.#dirty) {
      await this.onSave(true).catch((err) => console.error('flush on last disconnect failed:', err))
    }
  }

  // ── WebRTC signaling relay (peer-to-peer cursors and drag previews) ──
  // Browsers in the same room open direct data channels to each other; this relays only the
  // setup messages (offer / answer / ICE candidates) over the room's existing socket. The server
  // stamps who really sent each message and with what permission, so a peer can't claim to be
  // someone else or to have edit rights. Payload traffic never touches the server.
  static RTC_MAX_BYTES = 16_000
  static RTC_RATE_WINDOW_MS = 10_000
  static RTC_RATE_MAX = 120
  #rtcRate = new Map<string, { windowStart: number; count: number }>()

  onCustomMessage(connection: Connection, message: string) {
    if ((this.env.P2P_ENABLED as string | undefined) === '0') return // kill switch: clients quietly stay on the server path
    if (message.length > BoardRoom.RTC_MAX_BYTES) return
    let msg: { type?: string; kind?: string; from?: unknown; to?: unknown; data?: unknown }
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    if (msg?.type !== 'rtc' || typeof msg.from !== 'number' || typeof msg.to !== 'number') return
    if (msg.kind !== 'offer' && msg.kind !== 'answer' && msg.kind !== 'ice' && msg.kind !== 'bye') return

    const now = Date.now()
    const rate = this.#rtcRate.get(connection.id)
    if (!rate || now - rate.windowStart > BoardRoom.RTC_RATE_WINDOW_MS) {
      this.#rtcRate.set(connection.id, { windowStart: now, count: 1 })
    } else if (++rate.count > BoardRoom.RTC_RATE_MAX) {
      return
    }

    // The sender may only speak for awareness ids that connection actually owns.
    if (!awarenessIdsOf(connection).includes(msg.from)) return
    const sender = connection.state as ConnState | null
    if (!sender?.userId) return

    const relayed = JSON.stringify({
      type: 'rtc',
      kind: msg.kind,
      from: msg.from,
      to: msg.to,
      data: msg.data,
      fromUser: sender.userId, // server-stamped, never taken from the client
      perm: sender.permission ?? 'view',
    })
    for (const target of this.getConnections()) {
      if (target.id === connection.id) continue
      if (awarenessIdsOf(target).includes(msg.to)) this.sendCustomMessage(target, relayed)
    }
  }

  // Internal read-only endpoints used by the front Worker (/api/rooms/:id/*).
  async onRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path.endsWith('/broadcast') && request.method === 'POST') {
      // Pushes a server-originated message (e.g. a new comment) to everyone in the room.
      // Clients receive it as the provider's "custom-message" event.
      this.broadcastCustomMessage(await request.text())
      return Response.json({ ok: true, recipients: [...this.getConnections()].length })
    }
    if (path.endsWith('/connections')) return Response.json(this.#connections())
    if (path.endsWith('/awareness')) return Response.json({ states: this.#awareness() })
    return new Response('Not found', { status: 404 })
  }

  #connections() {
    const byUser = new Map<string, { userId: string; name: string; avatar: string | null; permission: BoardPermission; connectedAt: string }>()
    let total = 0
    for (const conn of this.getConnections<ConnState>()) {
      total += 1
      const s = conn.state
      if (!s?.userId || byUser.has(s.userId)) continue
      byUser.set(s.userId, {
        userId: s.userId,
        name: s.name ?? '',
        avatar: null,
        permission: s.permission ?? 'view',
        connectedAt: s.connectedAt ?? '',
      })
    }
    return { boardId: this.name, connectedUsers: [...byUser.values()], totalConnections: total }
  }

  #awareness() {
    return [...this.document.awareness.getStates().entries()].map(([clientId, state]) => ({
      clientId,
      user: state.user ?? null,
      cursor: state.cursor ?? null,
      selection: state.selection ?? [],
      editingItem: state.editingItem ?? null,
    }))
  }

  /** Best-effort ping so the board-projection cron prioritises recently edited boards. */
  #notifyDirty() {
    const send = async () => {
      const init: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.env.INTERNAL_API_SECRET}` },
        body: JSON.stringify({ boardIds: [this.name] }),
      }
      try {
        const res = this.env.APP
          ? await this.env.APP.fetch('https://app.internal/api/internal/board-dirty', init)
          : await fetch(`${this.env.APP_URL}/api/internal/board-dirty`, init)
        if (!res.ok) console.warn('board-dirty notify failed:', res.status)
      } catch (err) {
        console.warn('board-dirty notify error:', err)
      }
    }
    this.ctx.waitUntil(send())
  }
}
