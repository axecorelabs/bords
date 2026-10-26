/**
 * Peer-to-peer mesh for ephemeral realtime data (cursors, drag previews).
 *
 * Everyone in a SMALL room opens a direct WebRTC data channel to everyone else, so these updates skip
 * the trip through the server (and, from far-from-the-edge networks, the trip across a continent).
 *
 * It is purely additive. The server relay keeps carrying all of the same data; receivers keep whichever
 * copy is fresher (sequence numbers). So if a direct channel can't form (strict NAT, firewall, browser
 * without WebRTC, room too big) nothing breaks: that peer is simply served by the server path.
 *
 * Setup messages (offer / answer / ICE) travel over the board room's existing socket. The server stamps
 * each one with the sender's real userId and permission, so a peer can't claim to be someone else or to
 * have edit rights. Shape previews are only honoured from peers the server says can edit.
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
  awareness: {
    clientID: number
    getStates(): Map<number, any>
    on(event: 'change', cb: () => void): void
    off(event: 'change', cb: () => void): void
  }
  sendMessage(message: string): void
  on(event: 'custom-message', cb: (message: string) => void): void
  off(event: 'custom-message', cb: (message: string) => void): void
}

export interface MeshOptions {
  provider: SignalingProvider
  /** Defaults to the global RTCPeerConnection; injectable for tests. */
  RTCPeerConnectionCtor?: typeof RTCPeerConnection
  iceServers?: RTCIceServer[]
  /** Maximum number of OTHER people for the mesh to stay active (it is O(n^2) in connections). */
  maxPeers?: number
  connectTimeoutMs?: number
  onCursor?: (clientId: number, cursor: CursorPoint | null, seq: number) => void
  onShape?: (clientId: number, preview: ShapePreview) => void
  onShapeEnd?: (clientId: number, ids: string[]) => void
  onChange?: () => void
  debug?: boolean
}

type PeerStatus = 'connecting' | 'open' | 'failed'

interface Peer {
  id: number
  pc: RTCPeerConnection
  channel: RTCDataChannel | null
  status: PeerStatus
  initiator: boolean
  identity: { userId: string; permission: Permission } | null
  pendingIce: RTCIceCandidateInit[]
  remoteSet: boolean
  timeout: ReturnType<typeof setTimeout> | null
  attempts: number
}

const DEFAULT_ICE: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]
const MAX_BUFFERED = 64 * 1024
const MAX_ATTEMPTS = 3

export class P2PMesh {
  readonly #o: Required<Pick<MeshOptions, 'provider' | 'maxPeers' | 'connectTimeoutMs'>> & MeshOptions
  readonly #peers = new Map<number, Peer>()
  readonly #retry = new Map<number, ReturnType<typeof setTimeout>>()
  readonly #attempts = new Map<number, number>()
  #started = false
  #suspended = false

  constructor(options: MeshOptions) {
    this.#o = { maxPeers: 5, connectTimeoutMs: 8000, ...options }
  }

  get #localId() {
    return this.#o.provider.awareness.clientID
  }

  start() {
    if (this.#started) return
    this.#started = true
    this.#o.provider.on('custom-message', this.#onSignal)
    this.#o.provider.awareness.on('change', this.#onAwareness)
    this.#onAwareness()
  }

  stop() {
    if (!this.#started) return
    this.#started = false
    this.#o.provider.off('custom-message', this.#onSignal)
    this.#o.provider.awareness.off('change', this.#onAwareness)
    for (const t of this.#retry.values()) clearTimeout(t)
    this.#retry.clear()
    this.#closeAll(true)
  }

  // ── Sending (to every open direct channel) ────────────────────────────────

  sendCursor(cursor: CursorPoint | null, seq: number) {
    this.#broadcast(cursor ? { k: 'c', x: cursor.x, y: cursor.y, s: seq } : { k: 'c', x: null, y: null, s: seq })
  }

  sendShape(preview: ShapePreview) {
    this.#broadcast({ k: 's', i: preview.id, x: preview.x, y: preview.y, ...(preview.r !== undefined ? { r: preview.r } : {}) })
  }

  sendShapeEnd(ids: string[]) {
    this.#broadcast({ k: 'e', i: ids })
  }

  stats() {
    let open = 0
    for (const p of this.#peers.values()) if (p.status === 'open') open++
    return { peers: this.#peers.size, open, suspended: this.#suspended }
  }

  /** Is there a live direct channel to this client? */
  isDirect(clientId: number) {
    return this.#peers.get(clientId)?.status === 'open'
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

  // ── Who should we be connected to ─────────────────────────────────────────

  #onAwareness = () => {
    if (!this.#started) return
    const others = new Set<number>()
    for (const [id, state] of this.#o.provider.awareness.getStates()) {
      if (id !== this.#localId && state?.user) others.add(id)
    }

    if (others.size > this.#o.maxPeers) {
      // Too many people for a full mesh: hand everything back to the server path.
      if (!this.#suspended) {
        this.#suspended = true
        this.#log('room too large — suspending direct channels')
        this.#closeAll(true)
        this.#o.onChange?.()
      }
      return
    }
    this.#suspended = false

    for (const id of [...this.#peers.keys()]) if (!others.has(id)) this.#closePeer(id, true)
    for (const id of others) {
      if (this.#peers.has(id) || this.#retry.has(id)) continue
      // Exactly one side offers (the lower id), so two browsers never offer to each other at once.
      if (this.#localId < id) this.#connect(id, true)
    }
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
      identity: null,
      pendingIce: [],
      remoteSet: false,
      timeout: null,
      attempts: (this.#attempts.get(id) ?? 0) + (initiator ? 1 : 0),
    }
    this.#attempts.set(id, peer.attempts)
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
      this.#log('direct channel open with', peer.id)
      this.#o.onChange?.()
    }
    ch.onclose = () => this.#fail(peer.id, peer)
    ch.onmessage = (e) => this.#onData(peer, e.data)
  }

  #fail(id: number, peer: Peer) {
    if (this.#peers.get(id) !== peer) return
    const wasOpen = peer.status === 'open'
    this.#closePeer(id, false)
    this.#o.onChange?.()
    // Initiator retries with a growing delay; the other side just waits for the next offer.
    if (peer.initiator && this.#started && !this.#suspended && peer.attempts < MAX_ATTEMPTS) {
      const delay = wasOpen ? 1500 : 5000 * peer.attempts
      this.#retry.set(
        id,
        setTimeout(() => {
          this.#retry.delete(id)
          this.#onAwareness()
        }, delay)
      )
    }
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

  #onSignal = (raw: string) => {
    let msg: any
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }
    if (msg?.type !== 'rtc' || msg.to !== this.#localId || typeof msg.from !== 'number') return
    const from: number = msg.from
    const identity = { userId: String(msg.fromUser ?? ''), permission: (msg.perm ?? 'view') as Permission }

    if (msg.kind === 'bye') {
      this.#closePeer(from, false)
      return
    }
    if (this.#suspended || !this.#started) return

    if (msg.kind === 'offer') {
      // A newer offer replaces any half-open attempt from that peer.
      if (this.#peers.has(from)) this.#closePeer(from, false)
      const peer = this.#connect(from, false)
      if (!peer) return
      peer.identity = identity
      void this.#acceptOffer(peer, msg.data)
      return
    }

    const peer = this.#peers.get(from)
    if (!peer) return
    peer.identity = peer.identity ?? identity

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

  #onData(peer: Peer, data: unknown) {
    if (typeof data !== 'string' || data.length > 4096) return
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
    // Everything below changes what the receiver sees on the board, so it needs edit rights, as
    // stamped by the server when this peer's connection was set up.
    const canEdit = peer.identity?.permission === 'owner' || peer.identity?.permission === 'edit'
    if (!canEdit) return
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
