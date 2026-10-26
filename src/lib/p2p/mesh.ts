/**
 * Peer-to-peer mesh for ephemeral realtime data (cursors, drag previews).
 *
 * People in a room open direct WebRTC data channels to each other, so these updates skip the trip
 * through the server (and, from networks far from the nearest edge, the trip across a continent).
 *
 * It is purely additive. The server relay keeps carrying all of the same data; receivers keep whichever
 * copy is fresher (sequence numbers). So if a direct channel can't form (strict NAT, firewall, browser
 * without WebRTC, room too big) nothing breaks: that peer is simply served by the server path.
 *
 * WHO CONNECTS TO WHOM is decided from a roster the SERVER broadcasts (member -> clientId + the permission
 * the server knows they have), never from anything a client claims about itself:
 *   - an edge exists when at least one side can edit. Viewers have nothing to send each other that the
 *     server path can't carry, and a classroom of 2 editors + 30 viewers needs ~60 connections, not ~500;
 *   - the EDITOR starts the connection (ties: lower id), so a capped editor decides who it takes and a
 *     viewer just waits to be called;
 *   - nobody holds more than `maxConnections` channels; editors are served first, then viewers by id;
 *   - with more than `maxEditors` editors the whole mesh stands down (editor<->editor edges are mandatory
 *     and quadratic) and the server path carries everything.
 *
 * Setup messages (offer / answer / ICE) travel over the board room's existing socket. The server stamps
 * each one with the sender's real userId and permission. Shape previews and drag-end messages are only
 * honoured from peers who can edit.
 *
 * Unreliable + unordered channels (maxRetransmits: 0): for previews, the newest value matters and a
 * retransmitted old one is worse than a lost one.
 */

export type Permission = 'owner' | 'edit' | 'view'

export interface CursorPoint {
  x: number
  y: number
}

export interface ShapePreview {
  id: string
  x: number
  y: number
  r?: number
}

/** The slice of the sync provider the mesh needs (satisfied by y-partyserver's YProvider). */
export interface SignalingProvider {
  awareness: { clientID: number }
  sendMessage(message: string): void
  on(event: 'custom-message', cb: (message: string) => void): void
  off(event: 'custom-message', cb: (message: string) => void): void
}

export interface MeshOptions {
  provider: SignalingProvider
  /** Defaults to the global RTCPeerConnection; injectable for tests. */
  RTCPeerConnectionCtor?: typeof RTCPeerConnection
  iceServers?: RTCIceServer[]
  /** More editors than this and the mesh stands down (editor<->editor edges are O(n^2)). */
  maxEditors?: number
  /** Most direct channels any one person holds. */
  maxConnections?: number
  /** How many outgoing connections may be negotiating at once (smooths CPU and signaling bursts). */
  maxConcurrentSetups?: number
  connectTimeoutMs?: number
  onCursor?: (clientId: number, cursor: CursorPoint | null, seq: number) => void
  onShape?: (clientId: number, preview: ShapePreview) => void
  onShapeEnd?: (clientId: number, ids: string[]) => void
  onChange?: () => void
  debug?: boolean
}

type PeerStatus = 'connecting' | 'open'

interface Peer {
  id: number
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  status: PeerStatus
  initiator: boolean
  /** Identity the server stamped on this peer's setup messages. */
  stamped: { userId: string; permission: Permission } | null
  pendingIce: RTCIceCandidateInit[]
  remoteSet: boolean
  timeout: ReturnType<typeof setTimeout> | null
  startedAt: number
  rxWindowStart: number
  rxCount: number
}

interface RosterEntry {
  userId: string
  permission: Permission
}

const DEFAULT_ICE: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]
const MAX_BUFFERED = 64 * 1024
const MAX_ATTEMPTS = 3
/** A peer can't legitimately send more than this many messages in a second (cursor + previews ~120/s). */
const MAX_INBOUND_PER_SECOND = 400
const PENDING_OFFER_TTL_MS = 3000

const canEdit = (p: Permission | undefined) => p === 'owner' || p === 'edit'

export class P2PMesh {
  readonly #o: MeshOptions & { maxEditors: number; maxConnections: number; maxConcurrentSetups: number; connectTimeoutMs: number }
  readonly #peers = new Map<number, Peer>()
  readonly #retry = new Map<number, ReturnType<typeof setTimeout>>()
  readonly #attempts = new Map<number, number>()
  readonly #queue: number[] = []
  readonly #pendingOffers = new Map<number, { msg: any; at: number }>()
  readonly #throttles = new Map<string, { last: number; timer: ReturnType<typeof setTimeout> | null; pending: (() => void) | null }>()
  #roster = new Map<number, RosterEntry>()
  #rosterReceived = false
  #started = false
  #suspended = false
  #fullyDirectSince: number | null = null
  readonly #metrics = { connectMs: [] as number[], failures: 0, attempts: 0 }

  constructor(options: MeshOptions) {
    this.#o = { maxEditors: 12, maxConnections: 12, maxConcurrentSetups: 3, connectTimeoutMs: 8000, ...options }
  }

  get #localId() {
    return this.#o.provider.awareness.clientID
  }

  start() {
    if (this.#started) return
    this.#started = true
    this.#o.provider.on('custom-message', this.#onMessage)
  }

  stop() {
    if (!this.#started) return
    this.#started = false
    this.#o.provider.off('custom-message', this.#onMessage)
    for (const t of this.#retry.values()) clearTimeout(t)
    this.#retry.clear()
    for (const t of this.#throttles.values()) if (t.timer) clearTimeout(t.timer)
    this.#throttles.clear()
    this.#queue.length = 0
    this.#pendingOffers.clear()
    this.#closeAll(true)
    this.#rosterReceived = false
    this.#roster = new Map()
    this.#fullyDirectSince = null
  }

  // ── Sending (to every open direct channel) ────────────────────────────────

  sendCursor(cursor: CursorPoint | null, seq: number) {
    const msg = cursor ? { k: 'c', x: cursor.x, y: cursor.y, s: seq } : { k: 'c', x: null, y: null, s: seq }
    // A hide must not be delayed or coalesced away; positions are paced by how many people we feed
    if (cursor === null) this.#broadcast(msg)
    else this.#throttleSend('c', this.#gapMs('cursor'), () => this.#broadcast(msg))
  }

  sendShape(preview: ShapePreview) {
    const msg = { k: 's', i: preview.id, x: preview.x, y: preview.y, ...(preview.r !== undefined ? { r: preview.r } : {}) }
    this.#throttleSend(`s:${preview.id}`, this.#gapMs('shape'), () => this.#broadcast(msg))
  }

  sendShapeEnd(ids: string[]) {
    // Deliver any position still waiting on the pacing first, so "ended" can't overtake the final spot
    for (const id of ids) this.#flushThrottle(`s:${id}`)
    this.#broadcast({ k: 'e', i: ids })
  }

  /** More people to feed = fewer updates per second to each (upload grows with the number of channels). */
  #gapMs(kind: 'cursor' | 'shape'): number {
    const n = this.#openCount()
    if (n <= 6) return 0
    if (n <= 9) return kind === 'cursor' ? 25 : 20
    return kind === 'cursor' ? 40 : 30
  }

  #throttleSend(key: string, gap: number, fn: () => void) {
    if (gap === 0) {
      this.#flushThrottle(key, false)
      fn()
      return
    }
    const now = Date.now()
    const st = this.#throttles.get(key) ?? { last: 0, timer: null, pending: null }
    this.#throttles.set(key, st)
    if (!st.timer && now - st.last >= gap) {
      st.last = now
      fn()
      return
    }
    st.pending = fn // newest wins; the trailing send delivers it
    if (!st.timer) {
      st.timer = setTimeout(() => {
        st.timer = null
        const f = st.pending
        st.pending = null
        if (f) {
          st.last = Date.now()
          f()
        }
      }, Math.max(0, gap - (now - st.last)))
    }
  }

  #flushThrottle(key: string, run = true) {
    const st = this.#throttles.get(key)
    if (!st) return
    if (st.timer) clearTimeout(st.timer)
    st.timer = null
    const f = st.pending
    st.pending = null
    if (f && run) f()
    st.last = Date.now()
    if (!f) this.#throttles.delete(key) // idle entries don't pile up
  }

  stats() {
    return { peers: this.#peers.size, open: this.#openCount(), suspended: this.#suspended, wanted: this.#wanted().size }
  }

  /** Is there a live direct channel to this client? */
  isDirect(clientId: number) {
    return this.#peers.get(clientId)?.status === 'open'
  }

  /**
   * True when EVERY other person in the room is reachable over a direct channel, and has been for `minMs`.
   * Only then may the caller slow down its server-path updates; any gap means the server path must stay
   * at full rate for whoever isn't covered.
   */
  isFullyDirect(minMs = 2000): boolean {
    return this.#fullyDirectSince !== null && Date.now() - this.#fullyDirectSince >= minMs
  }

  /** Anonymous setup health, for monitoring (counts and timings only). */
  metrics() {
    const times = [...this.#metrics.connectMs].sort((a, b) => a - b)
    return {
      others: Math.max(0, this.#roster.size - 1),
      wanted: this.#wanted().size,
      open: this.#openCount(),
      attempts: this.#metrics.attempts,
      failures: this.#metrics.failures,
      medianConnectMs: times.length ? times[Math.floor(times.length / 2)] : null,
      suspended: this.#suspended,
    }
  }

  #openCount() {
    let n = 0
    for (const p of this.#peers.values()) if (p.status === 'open') n++
    return n
  }

  #broadcast(msg: unknown) {
    if (this.#peers.size === 0) return
    const text = JSON.stringify(msg)
    for (const p of this.#peers.values()) {
      const ch = p.channel
      if (p.status !== 'open' || !ch || ch.readyState !== 'open' || ch.bufferedAmount > MAX_BUFFERED) continue
      try {
        ch.send(text)
      } catch {
        // channel closing; the state handler cleans up
      }
    }
  }

  // ── Who should we be connected to (from the server's roster) ──────────────

  /** An edge exists when at least one side can edit. */
  #edge(a: RosterEntry, b: RosterEntry) {
    return canEdit(a.permission) || canEdit(b.permission)
  }

  /** The side that calls: editors call viewers; between equals the lower id calls. */
  #iAmInitiator(self: RosterEntry, otherId: number, other: RosterEntry) {
    if (canEdit(self.permission) !== canEdit(other.permission)) return canEdit(self.permission)
    return this.#localId < otherId
  }

  /** The people we hold (or should hold) channels with, editors first, capped. Deterministic. */
  #wanted(): Set<number> {
    const self = this.#roster.get(this.#localId)
    if (!self || this.#suspended) return new Set()
    const candidates: Array<[number, RosterEntry]> = []
    for (const [id, entry] of this.#roster) if (id !== this.#localId && this.#edge(self, entry)) candidates.push([id, entry])
    candidates.sort((a, b) => Number(canEdit(b[1].permission)) - Number(canEdit(a[1].permission)) || a[0] - b[0])
    return new Set(candidates.slice(0, this.#o.maxConnections).map(([id]) => id))
  }

  #reconcile() {
    if (!this.#started || !this.#rosterReceived) return
    const self = this.#roster.get(this.#localId)
    if (!self) return // the server hasn't seen our awareness yet; the next roster will include us

    let editors = 0
    for (const e of this.#roster.values()) if (canEdit(e.permission)) editors++
    const tooMany = editors > this.#o.maxEditors
    if (tooMany !== this.#suspended) {
      this.#suspended = tooMany
      this.#log(tooMany ? 'too many editors — standing down' : 'editor count ok again — resuming')
      if (tooMany) this.#closeAll(true)
      this.#o.onChange?.()
    }

    const wanted = this.#wanted()
    for (const id of [...this.#peers.keys()]) if (!wanted.has(id)) this.#closePeer(id, true)
    for (const id of [...this.#retry.keys()]) {
      if (!wanted.has(id)) {
        clearTimeout(this.#retry.get(id)!)
        this.#retry.delete(id)
      }
    }

    for (const id of wanted) {
      if (this.#peers.has(id) || this.#retry.has(id) || this.#queue.includes(id)) continue
      const other = this.#roster.get(id)!
      if (this.#iAmInitiator(self, id, other)) this.#queue.push(id)
    }
    this.#pump()
    this.#retryPendingOffers()
    this.#updateFullyDirect()
  }

  /** Start queued outgoing connections, a few at a time. */
  #pump() {
    let inFlight = 0
    for (const p of this.#peers.values()) if (p.initiator && p.status === 'connecting') inFlight++
    while (inFlight < this.#o.maxConcurrentSetups && this.#queue.length > 0) {
      const id = this.#queue.shift()!
      if (this.#peers.has(id) || !this.#wanted().has(id)) continue
      if (this.#connect(id, true)) inFlight++
    }
  }

  #updateFullyDirect() {
    const others = this.#roster.size - (this.#roster.has(this.#localId) ? 1 : 0)
    const full = others > 0 && this.#openCount() === others && !this.#suspended
    if (full && this.#fullyDirectSince === null) this.#fullyDirectSince = Date.now()
    else if (!full) this.#fullyDirectSince = null
  }

  // ── Connection setup ──────────────────────────────────────────────────────

  #connect(id: number, initiator: boolean): Peer | null {
    const Ctor = this.#o.RTCPeerConnectionCtor ?? (globalThis as any).RTCPeerConnection
    if (!Ctor) return null
    const pc: RTCPeerConnection = new Ctor({ iceServers: this.#o.iceServers ?? DEFAULT_ICE })
    const peer: Peer = {
      id,
      pc,
      channel: null,
      status: 'connecting',
      initiator,
      stamped: null,
      pendingIce: [],
      remoteSet: false,
      timeout: null,
      startedAt: Date.now(),
      rxWindowStart: 0,
      rxCount: 0,
    }
    if (initiator) {
      this.#attempts.set(id, (this.#attempts.get(id) ?? 0) + 1)
      this.#metrics.attempts++
    }
    this.#peers.set(id, peer)

    pc.onicecandidate = (e) => {
      if (e.candidate) this.#signal(id, 'ice', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate)
    }
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'failed' || s === 'closed') this.#fail(id, peer)
    }
    pc.ondatachannel = (e) => this.#attachChannel(peer, e.channel)

    peer.timeout = setTimeout(() => {
      if (peer.status !== 'open') this.#fail(id, peer)
    }, this.#o.connectTimeoutMs)

    if (initiator) {
      this.#attachChannel(peer, pc.createDataChannel('bords', { ordered: false, maxRetransmits: 0 }))
      void (async () => {
        try {
          await pc.setLocalDescription(await pc.createOffer())
          this.#signal(id, 'offer', { type: pc.localDescription!.type, sdp: pc.localDescription!.sdp })
        } catch (err) {
          this.#log('offer failed', err)
          this.#fail(id, peer)
        }
      })()
    }
    return peer
  }

  #attachChannel(peer: Peer, ch: RTCDataChannel) {
    peer.channel = ch
    ch.onopen = () => {
      if (this.#peers.get(peer.id) !== peer) return
      peer.status = 'open'
      if (peer.timeout) clearTimeout(peer.timeout)
      peer.timeout = null
      this.#attempts.set(peer.id, 0)
      this.#metrics.connectMs.push(Date.now() - peer.startedAt)
      if (this.#metrics.connectMs.length > 200) this.#metrics.connectMs.shift()
      this.#log('direct channel open with', peer.id)
      this.#updateFullyDirect()
      this.#pump() // a slot freed up for the next queued connection
      this.#o.onChange?.()
    }
    ch.onclose = () => this.#fail(peer.id, peer)
    ch.onmessage = (e) => this.#onData(peer, e.data)
  }

  #fail(id: number, peer: Peer) {
    if (this.#peers.get(id) !== peer) return
    const wasOpen = peer.status === 'open'
    if (!wasOpen) this.#metrics.failures++
    this.#closePeer(id, false)
    this.#updateFullyDirect()
    this.#o.onChange?.()
    const attempts = this.#attempts.get(id) ?? 0
    // The caller retries with a growing delay; the called side just waits for the next offer.
    if (peer.initiator && this.#started && !this.#suspended && attempts < MAX_ATTEMPTS && this.#wanted().has(id)) {
      const delay = wasOpen ? 1500 : 5000 * attempts
      this.#retry.set(
        id,
        setTimeout(() => {
          this.#retry.delete(id)
          this.#reconcile()
        }, delay)
      )
    }
    this.#pump()
  }

  #closePeer(id: number, notify: boolean) {
    const peer = this.#peers.get(id)
    if (!peer) return
    this.#peers.delete(id)
    if (peer.timeout) clearTimeout(peer.timeout)
    if (notify) this.#signal(id, 'bye', null)
    peer.pc.onicecandidate = null
    peer.pc.onconnectionstatechange = null
    try {
      peer.channel?.close()
    } catch {}
    try {
      peer.pc.close()
    } catch {}
  }

  #closeAll(notify: boolean) {
    for (const id of [...this.#peers.keys()]) this.#closePeer(id, notify)
  }

  // ── Signaling ─────────────────────────────────────────────────────────────

  #signal(to: number, kind: 'offer' | 'answer' | 'ice' | 'bye', data: unknown) {
    try {
      this.#o.provider.sendMessage(JSON.stringify({ type: 'rtc', kind, from: this.#localId, to, data }))
    } catch {
      // socket not open yet; the connect timeout / retry handles it
    }
  }

  #onMessage = (raw: string) => {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg?.type === 'roster') return this.#onRoster(msg)
    if (msg?.type !== 'rtc' || msg.to !== this.#localId || typeof msg.from !== 'number') return
    this.#onSignal(msg)
  }

  /** The server's authoritative member list (only the server ever sends this type). */
  #onRoster(msg: { members?: unknown }) {
    if (!Array.isArray(msg.members)) return
    const next = new Map<number, RosterEntry>()
    for (const m of msg.members.slice(0, 2000)) {
      if (m && typeof m.c === 'number' && typeof m.u === 'string') {
        next.set(m.c, { userId: m.u, permission: (['owner', 'edit', 'view'].includes(m.p) ? m.p : 'view') as Permission })
      }
    }
    this.#roster = next
    this.#rosterReceived = true
    this.#reconcile()
  }

  #onSignal(msg: any) {
    const from: number = msg.from
    const stamped = { userId: String(msg.fromUser ?? ''), permission: (msg.perm ?? 'view') as Permission }

    if (msg.kind === 'bye') {
      this.#closePeer(from, false)
      this.#updateFullyDirect()
      this.#o.onChange?.()
      return
    }
    if (this.#suspended || !this.#started) return

    if (msg.kind === 'offer') {
      this.#handleOffer(from, msg, stamped)
      return
    }

    const peer = this.#peers.get(from)
    if (!peer) return
    peer.stamped = peer.stamped ?? stamped

    if (msg.kind === 'answer') {
      void (async () => {
        try {
          await peer.pc.setRemoteDescription(msg.data)
          peer.remoteSet = true
          await this.#flushIce(peer)
        } catch (err) {
          this.#log('answer failed', err)
          this.#fail(from, peer)
        }
      })()
    } else if (msg.kind === 'ice' && msg.data) {
      if (peer.remoteSet) void peer.pc.addIceCandidate(msg.data).catch(() => {})
      else peer.pendingIce.push(msg.data)
    }
  }

  #handleOffer(from: number, msg: any, stamped: { userId: string; permission: Permission }) {
    // Only take calls we would have made or been expected to take: the roster decides.
    if (!this.#rosterReceived || !this.#roster.has(this.#localId) || !this.#roster.has(from)) {
      this.#pendingOffers.set(from, { msg, at: Date.now() }) // the roster may just be a moment behind the offer
      return
    }
    if (!this.#wanted().has(from)) {
      this.#log('ignoring an offer from someone we are not meant to connect with', from)
      return
    }
    if (this.#peers.has(from)) this.#closePeer(from, false) // a newer offer replaces a half-open attempt
    const peer = this.#connect(from, false)
    if (!peer) return
    peer.stamped = stamped
    void this.#acceptOffer(peer, msg.data)
  }

  #retryPendingOffers() {
    const now = Date.now()
    for (const [from, p] of [...this.#pendingOffers]) {
      if (now - p.at > PENDING_OFFER_TTL_MS) {
        this.#pendingOffers.delete(from)
      } else if (this.#roster.has(from) && this.#roster.has(this.#localId)) {
        this.#pendingOffers.delete(from)
        this.#handleOffer(from, p.msg, { userId: String(p.msg.fromUser ?? ''), permission: (p.msg.perm ?? 'view') as Permission })
      }
    }
  }

  async #acceptOffer(peer: Peer, offer: RTCSessionDescriptionInit) {
    try {
      await peer.pc.setRemoteDescription(offer)
      peer.remoteSet = true
      await peer.pc.setLocalDescription(await peer.pc.createAnswer())
      this.#signal(peer.id, 'answer', { type: peer.pc.localDescription!.type, sdp: peer.pc.localDescription!.sdp })
      await this.#flushIce(peer)
    } catch (err) {
      this.#log('accept offer failed', err)
      this.#fail(peer.id, peer)
    }
  }

  async #flushIce(peer: Peer) {
    const queued = peer.pendingIce.splice(0)
    for (const c of queued) await peer.pc.addIceCandidate(c).catch(() => {})
  }

  // ── Receiving ─────────────────────────────────────────────────────────────

  /** Permission as the server knows it: the roster, else what the server stamped on setup. */
  #permissionOf(peer: Peer): Permission | undefined {
    return this.#roster.get(peer.id)?.permission ?? peer.stamped?.permission
  }

  #onData(peer: Peer, data: unknown) {
    if (typeof data !== 'string' || data.length > 4096) return
    // A peer can't send us more than a person physically can; ignore floods rather than render them.
    const now = Date.now()
    if (now - peer.rxWindowStart >= 1000) {
      peer.rxWindowStart = now
      peer.rxCount = 0
    }
    if (++peer.rxCount > MAX_INBOUND_PER_SECOND) return

    let m: any
    try {
      m = JSON.parse(data)
    } catch {
      return
    }
    if (m.k === 'c') {
      if (typeof m.s !== 'number') return
      if (m.x === null) this.#o.onCursor?.(peer.id, null, m.s)
      else if (typeof m.x === 'number' && typeof m.y === 'number') this.#o.onCursor?.(peer.id, { x: m.x, y: m.y }, m.s)
      return
    }
    // Everything below changes what the receiver sees on the board, so it needs edit rights.
    if (!canEdit(this.#permissionOf(peer))) return
    if (m.k === 's' && typeof m.i === 'string' && typeof m.x === 'number' && typeof m.y === 'number') {
      this.#o.onShape?.(peer.id, { id: m.i, x: m.x, y: m.y, ...(typeof m.r === 'number' ? { r: m.r } : {}) })
    } else if (m.k === 'e' && Array.isArray(m.i)) {
      this.#o.onShapeEnd?.(peer.id, m.i.filter((x: unknown) => typeof x === 'string').slice(0, 50))
    }
  }

  #log(...args: unknown[]) {
    if (this.#o.debug) console.log('[p2p]', ...args)
  }
}
