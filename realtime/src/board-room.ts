import { YServer } from 'y-partyserver'
import type { Connection, ConnectionContext } from 'partyserver'
import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import { appendYUpdate, deleteYUpdates, loadYDoc, saveYDoc } from './supabase'

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
  // How long after the last edit (and at most how long into a stream of edits) before saving to Supabase.
  // Edits are journalled to this object's own storage immediately, so Supabase is a durable second copy
  // and the source other systems read, not the only place an edit lives; saving less often cuts write
  // load roughly 4x. (Overridable per deployment: SAVE_DEBOUNCE_MS / SAVE_MAX_WAIT_MS.)
  static callbackOptions = { debounceWait: 5000, debounceMaxWait: 30000 }

  #version = 0
  #dirty = false
  #lastEditor: string | null = null
  // State of what Supabase has: snapshot + change-log rows.
  #persistedSv: Uint8Array = Y.encodeStateVector(new Y.Doc()) // state vector of everything already in Supabase
  #logAvailable = true // false until/unless the yjs_updates table exists
  #hasSnapshot = false
  #maxUpdateId = 0
  #updatesSinceSnapshot = 0
  #deltaBytes = 0
  #lastSnapshotAt = 0
  #lastSnapshotBytes = 0
  // Set when something is still unsettled (leftovers found at start-up, a failed save). Alarms only force
  // a snapshot when this is set or a time-based compaction is genuinely due, so a stale alarm can never
  // turn an ordinary burst of editing into a full rewrite.
  #settlePending = false
  #failStreak = 0

  /** Base delay before retrying a failed save; doubles with each consecutive failure (capped) with jitter. */
  static RETRY_MS = 5_000
  static RETRY_MAX_MS = 60_000
  // Persistence: each save normally appends only what changed (a small row in yjs_updates). The log is
  // folded into a full snapshot (yjs_documents.state) when any of these is hit, when the last person
  // leaves, and by an alarm if edits stop, so the snapshot every other reader uses is never far behind.
  static COMPACT_AFTER_UPDATES = 60
  static COMPACT_AFTER_MS = 120_000
  static COMPACT_MIN_BYTES = 512_000
  // Overridable per deployment (the e2e tests shrink them to watch compaction happen in seconds).
  get #compactAfterUpdates() { return Number(this.env.COMPACT_AFTER_UPDATES) || BoardRoom.COMPACT_AFTER_UPDATES }
  get #compactAfterMs() { return Number(this.env.COMPACT_AFTER_MS) || BoardRoom.COMPACT_AFTER_MS }
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

    ;(this.constructor as typeof BoardRoom).callbackOptions = {
      debounceWait: Number(this.env.SAVE_DEBOUNCE_MS) || 5000,
      debounceMaxWait: Number(this.env.SAVE_MAX_WAIT_MS) || 30000,
    }
    await super.onStart() // runs onLoad() and wires the sync/awareness handlers

    this.document.on('update', (update: Uint8Array, origin: unknown) => {
      this.#dirty = true
      const editor = (origin as Connection<ConnState> | null)?.state?.userId
      if (editor) this.#lastEditor = editor
      this.#journalAppend(update)
    })

    // Anyone appearing in / leaving the awareness set changes the roster.
    this.document.awareness.on('update', ({ added, removed }: { added: number[]; removed: number[] }) => {
      if (added.length > 0 || removed.length > 0) this.#scheduleRoster()
    })

    // Edits that were journalled but never reached Supabase before this object last stopped, or a change
    // log that was never folded into a snapshot: settle both shortly.
    if (this.#journalRows() > 0 || this.#updatesSinceSnapshot > 0) {
      this.#dirty = true
      this.#settlePending = true
      await this.ctx.storage.setAlarm(Date.now() + 1_000)
    }
  }

  // Throws on a Supabase outage on purpose: starting from an empty document and
  // later saving it would overwrite the real one.
  async onLoad() {
    const stored = await loadYDoc(this.env, this.name)
    this.#version = stored.version
    this.#hasSnapshot = stored.state !== null
    this.#logAvailable = stored.logAvailable
    this.#maxUpdateId = stored.maxUpdateId
    this.#updatesSinceSnapshot = stored.updates.length
    this.#deltaBytes = stored.updates.reduce((n, u) => n + u.byteLength, 0)
    this.#lastSnapshotAt = Date.now()
    this.#lastSnapshotBytes = stored.state?.byteLength ?? 0

    const doc = new Y.Doc()
    if (stored.state) Y.applyUpdate(doc, stored.state)
    for (const update of stored.updates) Y.applyUpdate(doc, update)

    // Everything applied so far is already in Supabase. What is replayed from the local journal below
    // is not, so the first save must send it.
    this.#persistedSv = Y.encodeStateVector(doc)
    let journalled = false
    for (const row of this.#sql.exec('SELECT data FROM journal ORDER BY id')) {
      Y.applyUpdate(doc, new Uint8Array(row.data as ArrayBuffer)) // idempotent
      journalled = true
    }
    return stored.state || stored.updates.length > 0 || journalled ? doc : undefined
  }

  #compactionDue(): boolean {
    if (this.#updatesSinceSnapshot === 0) return false
    return (
      this.#updatesSinceSnapshot >= this.#compactAfterUpdates ||
      this.#deltaBytes >= Math.max(BoardRoom.COMPACT_MIN_BYTES, this.#lastSnapshotBytes * 0.5) ||
      Date.now() - this.#lastSnapshotAt >= this.#compactAfterMs
    )
  }

  async onSave(force = false) {
    if (!this.#dirty) return
    // First save of a board, a missing log table, a due compaction, or the final flush: write a full
    // snapshot. Otherwise append only what changed since the last save.
    const snapshot = force || !this.#logAvailable || !this.#hasSnapshot || this.#compactionDue()

    this.#dirty = false
    const journalUpTo = this.#journalMaxId() // everything journalled so far is inside what we encode now
    const svNow = Y.encodeStateVector(this.document)
    let bumpedVersion = false
    try {
      if (!snapshot) {
        const delta = Y.encodeStateAsUpdate(this.document, this.#persistedSv)
        if (delta.byteLength > 2) {
          const id = await appendYUpdate(this.env, this.name, delta)
          if (id === null) {
            // yjs_updates doesn't exist (migration not applied yet): behave as before, with full snapshots.
            this.#logAvailable = false
            this.#dirty = true
            await this.onSave(true)
            return
          }
          this.#maxUpdateId = Math.max(this.#maxUpdateId, id)
          this.#updatesSinceSnapshot += 1
          this.#deltaBytes += delta.byteLength
        }
        this.#persistedSv = svNow
        this.#failStreak = 0
        this.#sql.exec('DELETE FROM journal WHERE id <= ?', journalUpTo)
        // If edits now stop, make sure the log still gets folded into a snapshot.
        if (this.#updatesSinceSnapshot > 0) {
          await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000, this.#lastSnapshotAt + this.#compactAfterMs))
        }
        return
      }

      const state = Y.encodeStateAsUpdate(this.document)
      this.#version += 1
      bumpedVersion = true
      await saveYDoc(this.env, this.name, state, svNow, this.#version, this.#lastEditor)
      bumpedVersion = false
      if (this.#logAvailable) await deleteYUpdates(this.env, this.name, this.#maxUpdateId)
      this.#hasSnapshot = true
      this.#persistedSv = svNow
      this.#updatesSinceSnapshot = 0
      this.#deltaBytes = 0
      this.#lastSnapshotAt = Date.now()
      this.#lastSnapshotBytes = state.byteLength
      this.#failStreak = 0
      this.#sql.exec('DELETE FROM journal WHERE id <= ?', journalUpTo)
      this.#notifyDirty() // the AI/projection readers use the snapshot, which is now current
    } catch (err) {
      this.#dirty = true
      this.#settlePending = true
      if (bumpedVersion) this.#version -= 1
      // Don't wait for the next edit: try again, even if nobody is connected any more. Back off with
      // jitter: when Supabase comes back, hundreds of boards must not all retry in the same instant.
      this.#failStreak += 1
      const base = Number(this.env.SAVE_RETRY_BASE_MS) || BoardRoom.RETRY_MS
      const delay = Math.min(BoardRoom.RETRY_MAX_MS, base * 2 ** (this.#failStreak - 1)) * (0.75 + Math.random() * 0.5)
      await this.ctx.storage.setAlarm(Date.now() + delay)
      throw err
    }
  }

  async onAlarm() {
    const timeCompactionDue =
      this.#updatesSinceSnapshot > 0 && Date.now() - this.#lastSnapshotAt >= this.#compactAfterMs - 500
    if (!this.#settlePending && !timeCompactionDue) return // a stale alarm: nothing to do
    this.#settlePending = false
    this.#dirty = true // force a snapshot even if nothing changed since the last appended update
    await this.onSave(true).catch((err) => console.error('scheduled save failed:', err))
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
    if (remaining.length === 0 && (this.#dirty || this.#updatesSinceSnapshot > 0)) {
      this.#dirty = true
      await this.onSave(true).catch((err) => console.error('flush on last disconnect failed:', err))
    }
  }

  // ── Roster: who is in the room, with the permission the SERVER knows they have ──
  // Browsers use it to decide whom to connect to directly (editors need everyone; two viewers need
  // nothing from each other). Awareness can't be used for this: each client writes its own awareness,
  // so a "permission" there is only a claim. This message only ever originates here, because the server
  // never relays custom messages from clients except stamped WebRTC setup messages.
  #rosterTimer: ReturnType<typeof setTimeout> | null = null

  #scheduleRoster() {
    if ((this.env.P2P_ENABLED as string | undefined) === '0') return
    // Joins arrive in bursts; one coalesced broadcast per ~100ms instead of one per person
    this.#rosterTimer ??= setTimeout(() => {
      this.#rosterTimer = null
      const members: Array<{ c: number; u: string; p: BoardPermission }> = []
      for (const conn of this.getConnections()) {
        if (conn.readyState !== undefined && conn.readyState !== 1) continue // skip sockets that are closing
        const st = conn.state as ConnState | null
        if (!st?.userId) continue
        for (const c of awarenessIdsOf(conn)) members.push({ c, u: st.userId, p: st.permission ?? 'view' })
      }
      this.broadcastCustomMessage(JSON.stringify({ type: 'roster', members }))
    }, 100)
  }

  // ── WebRTC signaling relay (peer-to-peer cursors and drag previews) ──
  // Browsers in the same room open direct data channels to each other; this relays only the
  // setup messages (offer / answer / ICE candidates) over the room's existing socket. The server
  // stamps who really sent each message and with what permission, so a peer can't claim to be
  // someone else or to have edit rights. Payload traffic never touches the server.
  static RTC_MAX_BYTES = 16_000
  static RTC_RATE_WINDOW_MS = 10_000
  // Setting up one connection to each of 11 peers is a burst of ~50-80 messages; leave room for retries
  static RTC_RATE_MAX = 300
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
