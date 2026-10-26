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

function peer(room: string, userId: string, opts: { maxPeers?: number; noWebRTC?: boolean } = {}): Peer {
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
    maxPeers: opts.maxPeers,
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

  console.log('\nroom larger than maxPeers falls back, then recovers')
  const P = [0, 1, 2, 3].map((i) => peer('p2p-big', `big${i}`, { maxPeers: 2 }))
  await until(() => P.every((p) => p.provider.synced), 15000, 'big sync')
  P.forEach((p) => p.mesh.start())
  await sleep(2500)
  check('with 4 people and maxPeers=2 no direct channels are opened', P.every((p) => p.mesh.stats().open === 0 && p.mesh.stats().suspended))
  P[3].mesh.stop(); P[3].provider.destroy()
  P[2].mesh.stop(); P[2].provider.destroy()
  await until(() => P[0].mesh.stats().open === 1 && P[1].mesh.stats().open === 1, 15000, 'recover')
  check('when the room shrinks again, direct channels come back', true)
  stop([P[0], P[1]])

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
