import { P2PMesh, type CursorPoint, type ShapePreview, type SignalingProvider } from './mesh'
import { applyCursor } from '@/lib/cursor-positions'
import { trackEvent } from '@/lib/analytics'

/**
 * Owns the one P2PMesh for the board you're on, and is the single place the rest of the app talks to.
 * Everything here is best-effort: no WebRTC, a strict network, an opt-out, or a big room all just mean
 * "no direct channels", and the server path (which always runs) carries the same data.
 */

let mesh: P2PMesh | null = null
let cursorSeq = 0

interface ShapeHandlers {
  onShape?: (clientId: number, preview: ShapePreview) => void
  onShapeEnd?: (clientId: number, ids: string[]) => void
}
let shapeHandlers: ShapeHandlers = {}

export function isP2PEnabled(): boolean {
  if (typeof window === 'undefined' || typeof (globalThis as any).RTCPeerConnection === 'undefined') return false
  try {
    return window.localStorage.getItem('bords:p2p') !== 'off' // escape hatch: localStorage.setItem('bords:p2p', 'off')
  } catch {
    return true
  }
}

/** Per-sender, ever-increasing number stamped on every cursor update (both paths). */
export function nextCursorSeq(): number {
  return ++cursorSeq
}

/** Start direct connections for this provider's room. Returns a teardown function. */
export function startP2P(provider: SignalingProvider & { on: (e: string, cb: any) => void; off: (e: string, cb: any) => void }): () => void {
  if (!isP2PEnabled()) return () => {}
  stopP2P()

  const debug = (() => {
    try { return window.localStorage.getItem('bords:p2p-debug') === '1' } catch { return false }
  })()

  const m = new P2PMesh({
    provider,
    debug,
    onCursor: (clientId, cursor, seq) => applyCursor(clientId, cursor, seq),
    onShape: (clientId, preview) => shapeHandlers.onShape?.(clientId, preview),
    onShapeEnd: (clientId, ids) => shapeHandlers.onShapeEnd?.(clientId, ids),
  })
  mesh = m

  // Signaling rides the room socket, so (re)start whenever it is up and stop when it drops.
  const onStatus = ({ status }: { status: string }) => {
    if (status === 'connected') m.start()
    else if (status === 'disconnected') m.stop()
  }
  provider.on('status', onStatus)
  if ((provider as any).wsconnected) m.start()

  if (typeof window !== 'undefined') (window as any).__bordsP2P = { stats: () => m.stats(), metrics: () => m.metrics() }

  // Anonymous health numbers (counts and timings, no ids) so we can see how often direct channels
  // actually form for real users, and decide whether a relay server is ever worth adding.
  const report = (why: 'interval' | 'leave') => {
    const x = m.metrics()
    if (x.others === 0 && x.attempts === 0) return // nothing to say about a room of one
    trackEvent('p2p_stats', { why, ...x })
  }
  const reportTimer = setInterval(() => report('interval'), 2 * 60 * 1000)

  return () => {
    clearInterval(reportTimer)
    report('leave')
    provider.off('status', onStatus)
    m.stop()
    if (mesh === m) mesh = null
  }
}

/**
 * True when every other person in the room can be reached directly. Callers use it to slow down the
 * redundant server-path updates; any gap (a viewer, a failed connection) keeps the server path at full rate.
 */
export function isP2PFullyDirect(): boolean {
  return mesh?.isFullyDirect() ?? false
}

export function stopP2P() {
  mesh?.stop()
  mesh = null
}

export function sendP2PCursor(cursor: CursorPoint | null, seq: number) {
  mesh?.sendCursor(cursor, seq)
}

export function sendP2PShape(preview: ShapePreview) {
  mesh?.sendShape(preview)
}

export function sendP2PShapeEnd(ids: string[]) {
  mesh?.sendShapeEnd(ids)
}

/** The canvas registers how to show a collaborator's drag preview. Returns an unregister function. */
export function setShapeHandlers(h: ShapeHandlers): () => void {
  shapeHandlers = h
  return () => {
    if (shapeHandlers === h) shapeHandlers = {}
  }
}
