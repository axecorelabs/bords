/**
 * Peer-to-peer mesh test: real WebRTC (node-datachannel) + real signaling through the real Worker
 * (wrangler dev) + the real y-partyserver provider.
 *
 *   npx tsx test/p2p.test.ts
 */
import { spawn } from 'node:child_process'
import { hkdf } from 'node:crypto'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { EncryptJWT } from 'jose'
import WebSocket from 'ws'
import * as Y from 'yjs'
import YProvider from 'y-partyserver/provider'
import { RTCPeerConnection } from 'node-datachannel/polyfill'
import { P2PMesh, type CursorPoint, type ShapePreview } from '../../src/lib/p2p/mesh'

const MOCK_PORT = 9931
const WORKER_PORT = 8793
const SECRET = 'p2p-secret'
const INTERNAL = 'p2p-internal'
const ORIGIN = 'http://localhost:3000'
const host = `127.0.0.1:${WORKER_PORT}`

const mock = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
  const send = (s: number, d: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)) }
  if (url.pathname === '/api/internal/board-access') return send(200, { permission: String(body.userId).startsWith('viewer') ? 'view' : 'edit' })
  if (url.pathname === '/api/internal/board-dirty') return send(200, { ok: true })
  if (url.pathname === '/rest/v1/') return send(200, {})
  if (url.pathname === '/rest/v1/yjs_documents') return req.method === 'GET' ? send(200, []) : send(201, {})
  send(404, {})
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(fn: () => boolean, ms = 12000, what = 'condition') {
  const t = Date.now()
  while (Date.now() - t < ms) { if (fn()) return; await sleep(50) }
  throw new Error('timed out waiting for ' + what)
}
let failures = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

const hkdfAsync = promisify(hkdf)
let key: Uint8Array
async function ticket(userId: string) {
  key ??= new Uint8Array(await hkdfAsync('sha256', SECRET, '', 'NextAuth.js Generated Encryption Key', 32))
  return new EncryptJWT({ sub: userId, email: `${userId}@t.dev`, name: userId }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuedAt().setExpirationTime('10m').encrypt(key)
}

interface Peer {
  name: string
  doc: Y.Doc
  provider: any
  mesh: P2PMesh
  cursors: Array<{ from: number; cursor: CursorPoint | null; seq: number; at: number }>
  shapes: Array<{ from: number; preview: ShapePreview }>
  ends: string[][]
}

function peer(room: string, userId: string, opts: { maxEditors?: number; maxConnections?: number; noWebRTC?: boolean } = {}): Peer {
  const doc = new Y.Doc()
  const token = ticket(userId)
  const provider: any = new YProvider(host, room, doc, {
    protocol: 'ws', prefix: `/ws/${room}`, disableBc: true,
    WebSocketPolyfill: class extends WebSocket { constructor(u: any, p: any) { super(u, p, { headers: { Origin: ORIGIN } }) } } as any,
    params: async () => ({ token: await token }),
  })
  provider.awareness.setLocalStateField('user', { id: userId, name: userId, color: '#000' })
  const p: Peer = { name: userId, doc, provider, cursors: [], shapes: [], ends: [], mesh: null as any }
  p.mesh = new P2PMesh({
    provider,
    RTCPeerConnectionCtor: opts.noWebRTC ? (undefined as any) : (RTCPeerConnection as any),
    iceServers: [], // loopback: host candidates are enough
    maxEditors: opts.maxEditors,
    maxConnections: opts.maxConnections,
    connectTimeoutMs: 8000,
    onCursor: (from, cursor, seq) => p.cursors.push({ from, cursor, seq, at: performance.now() }),
    onShape: (from, preview) => p.shapes.push({ from, preview }),
    onShapeEnd: (_f, ids) => p.ends.push(ids),
  })
  return p
}
const stop = (ps: Peer[]) => ps.forEach((p) => { p.mesh.stop(); p.provider.destroy() })

async function main() {
  console.log('three people, full mesh')
  const A = peer('p2p-room', 'alice'), B = peer('p2p-room', 'bob'), C = peer('p2p-room', 'viewer-carol')
  const all = [A, B, C]
  await until(() => all.every((p) => p.provider.synced), 15000, 'sync')
  all.forEach((p) => p.mesh.start())
  await until(() => all.every((p) => p.mesh.stats().open === 2), 15000, 'direct channels')
  check('every pair opened a direct channel (2 each)', true)
  check('isDirect() reflects it', A.mesh.isDirect(B.doc.clientID) && A.mesh.isDirect(C.doc.clientID))

  console.log('\ncursors')
  A.mesh.sendCursor({ x: 10, y: 20 }, 1)
  await until(() => B.cursors.length >= 1 && C.cursors.length >= 1, 5000, 'cursor delivery')
  check('cursor reaches every peer with its values and sequence', B.cursors[0].from === A.doc.clientID && B.cursors[0].cursor?.x === 10 && B.cursors[0].seq === 1 && C.cursors[0].cursor?.y === 20)
  A.mesh.sendCursor(null, 2)
  await until(() => B.cursors.some((c) => c.cursor === null && c.seq === 2), 5000, 'cursor hide')
  check('a hidden cursor (null) is delivered too', true)
  C.mesh.sendCursor({ x: 5, y: 6 }, 1)
  await until(() => A.cursors.some((c) => c.from === C.doc.clientID), 5000, 'viewer cursor')
  check('a VIEWER\'s cursor is accepted (cursors are harmless)', true)

  console.log('\nshape previews and permissions')
  A.mesh.sendShape({ id: 'shape:one', x: 100, y: 200, r: 0.5 })
  await until(() => B.shapes.length >= 1 && C.shapes.length >= 1, 5000, 'shape preview')
  check('an editor\'s drag preview reaches everyone', B.shapes[0].preview.id === 'shape:one' && B.shapes[0].preview.x === 100 && B.shapes[0].preview.r === 0.5)
  C.mesh.sendShape({ id: 'shape:evil', x: 1, y: 1 })
  C.mesh.sendShapeEnd(['shape:evil'])
  await sleep(1200)
  check('a viewer\'s shape previews are ignored by everyone', !A.shapes.some((s) => s.preview.id === 'shape:evil') && !B.shapes.some((s) => s.preview.id === 'shape:evil'))
  check('...and so are its drag-end messages', A.ends.length === 0 && B.ends.length === 0)
  A.mesh.sendShapeEnd(['shape:one'])
  await until(() => B.ends.length >= 1, 5000, 'drag end')
  check('an editor\'s drag-end is delivered', B.ends[0][0] === 'shape:one')

  console.log('\nlatency on this machine (loopback, informational)')
  {
    const lat: number[] = []
    const n0 = B.cursors.length
    for (let i = 0; i < 40; i++) { A.mesh.sendCursor({ x: i, y: performance.now() }, 100 + i); await sleep(15) }
    await sleep(300)
    for (const c of B.cursors.slice(n0)) if (c.cursor) lat.push(c.at - c.cursor.y)
    lat.sort((a, b) => a - b)
    console.log(`  direct channel one-way: n=${lat.length} p50=${lat[Math.floor(lat.length / 2)]?.toFixed(1)}ms`)
    check('direct messages arrive (most of 40)', lat.length >= 30, `${lat.length}`)
  }

  console.log('\na peer leaves')
  const leaverId = C.doc.clientID
  C.mesh.stop(); C.provider.destroy()
  await until(() => A.mesh.stats().open === 1 && B.mesh.stats().open === 1, 10000, 'channel cleanup')
  check('channels to the leaver are closed on both sides', !A.mesh.isDirect(leaverId) && !B.mesh.isDirect(leaverId))
  stop([A, B])

  console.log('\nmore editors than allowed: the mesh stands down, then recovers')
  const P = [0, 1, 2, 3].map((i) => peer('p2p-big', `big${i}`, { maxEditors: 2 }))
  await until(() => P.every((p) => p.provider.synced), 15000, 'big sync')
  P.forEach((p) => p.mesh.start())
  await sleep(2500)
  check('with 4 editors and maxEditors=2 no direct channels are opened', P.every((p) => p.mesh.stats().open === 0 && p.mesh.stats().suspended))
  P[3].mesh.stop(); P[3].provider.destroy()
  P[2].mesh.stop(); P[2].provider.destroy()
  await until(() => P[0].mesh.stats().open === 1 && P[1].mesh.stats().open === 1, 15000, 'recover')
  check('when the editors drop to the limit, direct channels come back', true)
  stop([P[0], P[1]])

  console.log('\nroles decide the topology: 2 editors + 3 viewers')
  {
    const E1 = peer('p2p-roles', 'ed1'), E2 = peer('p2p-roles', 'ed2')
    const V1 = peer('p2p-roles', 'viewer-1'), V2 = peer('p2p-roles', 'viewer-2'), V3 = peer('p2p-roles', 'viewer-3')
    const all = [E1, E2, V1, V2, V3]
    await until(() => all.every((p) => p.provider.synced), 15000, 'roles sync')
    all.forEach((p) => p.mesh.start())
    // editors: 1 editor + 3 viewers = 4; viewers: the 2 editors only = 2
    await until(() => E1.mesh.stats().open === 4 && E2.mesh.stats().open === 4 && [V1, V2, V3].every((v) => v.mesh.stats().open === 2), 20000, 'role mesh')
    check('editors connect to everyone; viewers connect only to editors (4,4,2,2,2 channels)', true)
    check('two viewers are NOT directly connected to each other', !V1.mesh.isDirect(V2.doc.clientID) && !V2.mesh.isDirect(V3.doc.clientID) && !V1.mesh.isDirect(V3.doc.clientID))
    check('..but every editor/viewer pair is', [V1, V2, V3].every((v) => v.mesh.isDirect(E1.doc.clientID) && v.mesh.isDirect(E2.doc.clientID)))
    check('a room with viewers is not "fully direct" (viewers keep the server path)', !V1.mesh.isFullyDirect(0))
    check('no connection attempts failed on the way (editors call viewers, viewers wait)', all.every((p) => p.mesh.metrics().failures === 0), JSON.stringify(all.map((p) => p.mesh.metrics().failures)))
    // a viewer's cursor still reaches editors directly
    V1.mesh.sendCursor({ x: 3, y: 4 }, 1)
    await until(() => E1.cursors.some((c) => c.from === V1.doc.clientID) && E2.cursors.some((c) => c.from === V1.doc.clientID), 5000, 'viewer cursor to editors')
    check('a viewer\'s cursor reaches the editors directly', true)
    stop(all)
  }

  console.log('\nconnection cap: one editor, many viewers')
  {
    const ed = peer('p2p-cap', 'cap-ed', { maxConnections: 3 })
    const vs = [0, 1, 2, 3, 4, 5].map((i) => peer('p2p-cap', `viewer-cap${i}`, { maxConnections: 3 }))
    const all = [ed, ...vs]
    await until(() => all.every((p) => p.provider.synced), 15000, 'cap sync')
    all.forEach((p) => p.mesh.start())
    await until(() => ed.mesh.stats().open === 3, 20000, 'cap channels')
    await sleep(2500)
    check('the editor holds exactly its cap of 3 channels', ed.mesh.stats().open === 3, String(ed.mesh.stats().open))
    const connected = vs.filter((v) => v.mesh.stats().open === 1)
    check('exactly 3 viewers got a direct channel, the rest stay on the server path', connected.length === 3, String(connected.length))
    const lowest = [...vs].sort((a, b) => a.doc.clientID - b.doc.clientID).slice(0, 3).map((v) => v.doc.clientID).sort()
    check('...the lowest client ids, deterministically', connected.map((v) => v.doc.clientID).sort().join() === lowest.join())
    check('the viewers left out did not waste attempts (the editor is the caller)', vs.every((v) => v.mesh.metrics().attempts === 0 && v.mesh.metrics().failures === 0))
    stop(all)
  }

  console.log('\nfully direct, then a channel drops')
  {
    const [a, b, c] = ['fd-a', 'fd-b', 'fd-c'].map((n) => peer('p2p-fd', n))
    const all = [a, b, c]
    await until(() => all.every((p) => p.provider.synced), 15000, 'fd sync')
    all.forEach((p) => p.mesh.start())
    await until(() => all.every((p) => p.mesh.stats().open === 2), 15000, 'fd mesh')
    check('not "fully direct" until it has been stable for a moment', !a.mesh.isFullyDirect(1500))
    await sleep(1700)
    check('all editors, all channels open and stable -> fully direct (server path may slow down)', all.every((p) => p.mesh.isFullyDirect(1500)))
    c.mesh.stop(); c.provider.destroy()
    await until(() => !a.mesh.isFullyDirect(0) || a.mesh.stats().open === 1, 10000, 'drop noticed')
    await until(() => a.mesh.stats().open === 1 && b.mesh.stats().open === 1, 10000, 'cleanup')
    await until(() => a.mesh.metrics().others === 1 && b.mesh.metrics().others === 1, 10000, 'roster update')
    await sleep(2100)
    check('after someone leaves, the remaining pair is fully direct again with no one missing', a.mesh.isFullyDirect(2000) && b.mesh.isFullyDirect(2000))
    stop([a, b])
  }

  console.log('\nadaptive send rate and flood protection (8 editors)')
  {
    const ps = Array.from({ length: 8 }, (_, i) => peer('p2p-rate', `rate${i}`))
    await until(() => ps.every((p) => p.provider.synced), 15000, 'rate sync')
    ps.forEach((p) => p.mesh.start())
    await until(() => ps.every((p) => p.mesh.stats().open === 7), 25000, 'rate mesh')
    const [sender, recv] = ps
    const before = recv.cursors.filter((c) => c.from === sender.doc.clientID).length
    const t0 = performance.now()
    let seq = 1000
    while (performance.now() - t0 < 1000) { sender.mesh.sendCursor({ x: seq, y: 0 }, seq++); await sleep(2) }
    await sleep(300)
    const got = recv.cursors.filter((c) => c.from === sender.doc.clientID).slice(before)
    check('with 7 peers to feed, ~500 calls a second become ~40 updates a second', got.length >= 15 && got.length <= 60, `${got.length} delivered`)
    check('...and the LAST position is always delivered', got[got.length - 1]?.cursor?.x === seq - 1, `${got[got.length - 1]?.cursor?.x} vs ${seq - 1}`)
    // a hide is never delayed or coalesced away
    sender.mesh.sendCursor({ x: 1, y: 1 }, seq + 1); sender.mesh.sendCursor(null, seq + 2)
    await until(() => recv.cursors.some((c) => c.seq === seq + 2 && c.cursor === null), 3000, 'hide delivered')
    check('a hide message goes out immediately', true)
    stop(ps)
  }

  console.log('\nflood protection against a modified client')
  {
    // A normal client paces itself, so to model a hostile one we grab its raw data channel and blast it.
    const channels: any[] = []
    class SpyRTC extends (RTCPeerConnection as any) {
      createDataChannel(...args: any[]) { const ch = super.createDataChannel(...args); channels.push(ch); return ch }
    }
    const spyPeer = (room: string, userId: string) => {
      const d = new Y.Doc(); const t = ticket(userId)
      const provider: any = new YProvider(host, room, d, { protocol: 'ws', prefix: `/ws/${room}`, disableBc: true,
        WebSocketPolyfill: class extends WebSocket { constructor(u: any, p: any) { super(u, p, { headers: { Origin: ORIGIN } }) } } as any, params: async () => ({ token: await t }) })
      provider.awareness.setLocalStateField('user', { id: userId, name: userId, color: '#000' })
      const shapes: any[] = []
      const mesh = new P2PMesh({ provider, RTCPeerConnectionCtor: SpyRTC as any, iceServers: [], onShape: (_f, p) => shapes.push(p) })
      return { provider, mesh, shapes, doc: d }
    }
    const A = spyPeer('p2p-flood2', 'flood-1'), B = spyPeer('p2p-flood2', 'flood-2')
    await until(() => A.provider.synced && B.provider.synced, 15000, 'flood sync')
    A.mesh.start(); B.mesh.start()
    await until(() => A.mesh.stats().open === 1 && B.mesh.stats().open === 1, 15000, 'flood channel')
    const raw = channels.find((c) => c.readyState === 'open')
    check('(setup) got hold of the raw channel of a connected peer', !!raw)
    const lowId = Math.min(A.doc.clientID, B.doc.clientID)
    const receiver = A.doc.clientID === lowId ? B : A // the one NOT holding the spy channel
    const before = receiver.shapes.length
    const t0 = performance.now()
    let sent = 0
    while (performance.now() - t0 < 700) {
      for (let i = 0; i < 50; i++) { try { raw.send(JSON.stringify({ k: 's', i: 'shape:spam', x: sent, y: sent })); sent++ } catch { break } }
      await sleep(1)
    }
    await sleep(1200)
    const processed = receiver.shapes.length - before
    console.log(`  hostile peer sent ${sent} previews in 0.7s; receiver processed ${processed}`)
    check('the receiver caps what it will process per second from one peer', processed > 0 && processed < Math.min(sent, 900), `${processed} of ${sent}`)
    A.mesh.stop(); B.mesh.stop(); A.provider.destroy(); B.provider.destroy()
  }

  console.log('\n12 editors: full mesh (66 connections)')
  {
    const ps = Array.from({ length: 12 }, (_, i) => peer('p2p-twelve', `twelve${i}`))
    await until(() => ps.every((p) => p.provider.synced), 20000, 'twelve sync')
    const t0 = Date.now()
    ps.forEach((p) => p.mesh.start())
    await until(() => ps.every((p) => p.mesh.stats().open === 11), 60000, 'twelve mesh')
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    console.log(`  full mesh of 12 formed in ${secs}s`)
    check('all 12 editors reached 11 direct channels each', true)
    check('no setup failures, and everyone is fully direct', ps.every((p) => p.mesh.metrics().failures === 0) && ps.every((p) => p.mesh.stats().wanted === 11))
    ps[0].mesh.sendCursor({ x: 9, y: 9 }, 1)
    await until(() => ps.slice(1).every((p) => p.cursors.some((c) => c.cursor?.x === 9)), 5000, 'twelve cursor')
    check('a cursor from one reaches the other 11 directly', true)
    stop(ps)
  }

  console.log('\nno WebRTC available')
  const N1 = peer('p2p-nowebrtc', 'n1', { noWebRTC: true }), N2 = peer('p2p-nowebrtc', 'n2', { noWebRTC: true })
  await until(() => N1.provider.synced && N2.provider.synced, 15000, 'nowebrtc sync')
  N1.mesh.start(); N2.mesh.start()
  N1.mesh.sendCursor({ x: 1, y: 1 }, 1) // must not throw
  await sleep(1500)
  check('without WebRTC the mesh stays inert and nothing throws', N1.mesh.stats().open === 0 && N2.cursors.length === 0)
  stop([N1, N2])
}

mock.listen(MOCK_PORT)
const worker = spawn('npx', ['wrangler', 'dev', '-c', 'test/wrangler.test.jsonc', '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--inspector-port', '0',
  '--var', `APP_URL:http://localhost:${MOCK_PORT}`, '--var', `SUPABASE_URL:http://localhost:${MOCK_PORT}`, '--var', `ALLOWED_ORIGINS:${ORIGIN}`,
  '--var', `NEXTAUTH_SECRET:${SECRET}`, '--var', `INTERNAL_API_SECRET:${INTERNAL}`, '--var', 'SUPABASE_SERVICE_ROLE_KEY:svc'], { stdio: 'ignore' })

;(async () => {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://${host}/health`)).ok) break } catch {} await sleep(500) }
  await main()
})()
  .catch((e) => { failures++; console.error('TEST ERROR:', e.message) })
  .finally(() => { worker.kill('SIGTERM'); mock.close(); console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED'); setTimeout(() => process.exit(failures ? 1 : 0), 500) })
