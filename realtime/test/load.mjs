// Load test: boots the real Worker with `wrangler dev` against a trivial mock backend.
//
//   node test/load.mjs                # default scenarios
//   node test/load.mjs hot 40 10      # one scenario: hot room, 40 people, 10 updates/s each
//   node test/load.mjs rooms 100 4    # 100 rooms x 4 people
//
// Local workerd on one machine is only a rough guide (the load generator shares the CPU), and a local
// run has no internet latency, so read the numbers as "relative delay added by the server + fan-out".
import { spawn } from 'node:child_process'
import { hkdf } from 'node:crypto'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { EncryptJWT } from 'jose'
import WebSocket from 'ws'
import * as Y from 'yjs'
import YProvider from 'y-partyserver/provider'

let PRESENCE_USERS = 0
const MOCK_PORT = 9921
const WORKER_PORT = 8792
const SECRET = 'load-secret'
const INTERNAL = 'load-internal'
const ORIGIN = 'http://localhost:3000'
const host = `127.0.0.1:${WORKER_PORT}`

const rows = new Map()
const mock = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
  const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)) }
  if (url.pathname === '/api/internal/board-access') return send(200, { permission: 'edit' })
  if (url.pathname === '/api/internal/board-dirty') return send(200, { ok: true })
  if (url.pathname === '/rest/v1/') return send(200, {})
  if (url.pathname === '/rest/v1/conversation_members') {
    // every 'lp-*' user is in one big conversation 'big'
    const uid = url.searchParams.get('user_id') ?? ''
    if (uid.startsWith('eq.lp-')) return send(200, [{ conversation_id: 'big' }])
    if (uid.startsWith('neq.lp-')) return send(200, Array.from({ length: PRESENCE_USERS }, (_, i) => ({ user_id: `lp-${i}` })).filter((m) => m.user_id !== uid.slice(4)))
    return send(200, [])
  }
  if (url.pathname === '/rest/v1/yjs_documents') {
    if (req.method === 'GET') { const r = rows.get(url.searchParams.get('board_id').replace(/^eq\./, '')); return send(200, r ? [{ state: r.state, version: r.version }] : []) }
    rows.set(body.board_id, body); return send(201, {})
  }
  send(404, {})
})

const hkdfAsync = promisify(hkdf)
let key
async function ticket(userId) {
  key ??= new Uint8Array(await hkdfAsync('sha256', SECRET, '', 'NextAuth.js Generated Encryption Key', 32))
  return new EncryptJWT({ sub: userId, email: `${userId}@t.dev`, name: userId }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuedAt().setExpirationTime('30m').encrypt(key)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pct = (xs, p) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const fmt = (xs) => xs.length ? `p50=${pct(xs, .5).toFixed(0)}ms p95=${pct(xs, .95).toFixed(0)}ms p99=${pct(xs, .99).toFixed(0)}ms max=${xs.reduce((m, v) => (v > m ? v : m), 0).toFixed(0)}ms` : 'no samples'

function client(room, id, onAwareness) {
  const doc = new Y.Doc()
  const token = ticket(id)
  const p = new YProvider(host, room, doc, {
    protocol: 'ws', prefix: `/ws/${room}`, disableBc: true,
    WebSocketPolyfill: class extends WebSocket { constructor(u, pr) { super(u, pr, { headers: { Origin: ORIGIN } }) } },
    params: async () => ({ token: await token }),
  })
  p.awareness.setLocalStateField('user', { id, name: id, color: '#000' })
  if (onAwareness) p.awareness.on('update', ({ updated, added }, origin) => {
    if (origin === 'local') return
    const now = performance.now()
    for (const cid of [...added, ...updated]) {
      if (cid === p.awareness.clientID) continue
      const c = p.awareness.getStates().get(cid)?.cursor
      if (c) onAwareness(now - c.t)
    }
  })
  return { doc, p }
}

async function connectAll(clients, timeout = 60000) {
  const t0 = Date.now()
  while (clients.some((c) => !c.p.synced)) {
    if (Date.now() - t0 > timeout) throw new Error(`only ${clients.filter((c) => c.p.synced).length}/${clients.length} connected`)
    await sleep(100)
  }
  return Date.now() - t0
}

async function hotRoom(n, rate, seconds = 10) {
  console.log(`\nHOT ROOM: ${n} people, each moving a cursor ${rate}/s for ${seconds}s  (=> ${(n * rate * (n - 1)).toLocaleString()} relayed msgs/s expected)`)
  const lat = []
  const clients = Array.from({ length: n }, (_, i) => client(`hot-${n}`, `u${i}`, (d) => lat.push(d)))
  const connectMs = await connectAll(clients)
  console.log(`  all connected in ${(connectMs / 1000).toFixed(1)}s`)
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable()
  lat.length = 0
  const end = performance.now() + seconds * 1000
  const timers = clients.map((c, i) => setInterval(() => c.p.awareness.setLocalStateField('cursor', { x: i, y: i, t: performance.now() }), 1000 / rate))
  await sleep(seconds * 1000)
  timers.forEach(clearInterval)
  await sleep(1500)
  lag.disable()
  const expected = n * rate * seconds * (n - 1)
  console.log(`  delivered ${lat.length.toLocaleString()} / ~${expected.toLocaleString()} sent  (${(100 * lat.length / expected).toFixed(0)}%; below 100% can be coalescing: only the newest cursor state in a batch window is sent)`)
  console.log(`  delay        ${fmt(lat)}`)
  console.log(`  load-generator event-loop delay p99=${(lag.percentile(99) / 1e6).toFixed(0)}ms ${lag.percentile(99) / 1e6 > 50 ? '<-- generator is saturated; numbers above are pessimistic' : '(generator healthy)'}`)
  clients.forEach((c) => c.p.destroy())
  await sleep(500)
}

async function manyRooms(rooms, perRoom, seconds = 10) {
  console.log(`\nMANY ROOMS: ${rooms} boards x ${perRoom} people, one doc edit/s each for ${seconds}s`)
  const lat = []
  const all = []
  const t0 = performance.now()
  for (let r = 0; r < rooms; r++) {
    for (let i = 0; i < perRoom; i++) {
      const c = client(`room-${r}`, `r${r}u${i}`)
      c.doc.getMap('m').observe((ev) => { ev.keysChanged.forEach((k) => { const t = Number(k.split('@')[1]); if (t && k.split('@')[0] !== c.id) lat.push(performance.now() - t) }) })
      c.id = `r${r}u${i}`
      all.push(c)
    }
  }
  let connectMs
  try { connectMs = await connectAll(all, 120000) } catch (e) { console.log('  ', e.message); all.forEach((c) => c.p.destroy()); return }
  console.log(`  ${all.length} sockets connected in ${(connectMs / 1000).toFixed(1)}s`)
  lat.length = 0
  const timers = all.map((c) => setInterval(() => c.doc.getMap('m').set(`${c.id}@${performance.now()}`, 1), 1000))
  await sleep(seconds * 1000)
  timers.forEach(clearInterval)
  await sleep(1500)
  const expected = rooms * perRoom * (perRoom - 1) * seconds
  console.log(`  delivered ${lat.length.toLocaleString()} / ~${expected.toLocaleString()} expected (${(100 * lat.length / expected).toFixed(0)}%)`)
  console.log(`  delay        ${fmt(lat)}`)
  all.forEach((c) => c.p.destroy())
  await sleep(1000)
}

async function presenceSurge(n) {
  PRESENCE_USERS = n
  console.log(`\nPRESENCE SURGE: ${n} people in one conversation connect at once (=> ${(n * (n - 1)).toLocaleString()} "is online" notifications)`)
  const socks = []
  const t0 = performance.now()
  const seen = new Map()
  await Promise.all(Array.from({ length: n }, async (_, i) => {
    const id = `lp-${i}`
    const set = new Set(); seen.set(id, set)
    const ws = new WebSocket(`ws://${host}/messaging`, ['bords-messaging', await ticket(id)], { headers: { Origin: ORIGIN } })
    ws.on('message', (d) => { const t = d.toString(); if (t === 'pong') return; const m = JSON.parse(t); if (m.type === 'presence_update' && m.online) set.add(m.userId) })
    ws.on('error', () => {})
    socks.push(ws)
  }))
  let done = false
  const deadline = performance.now() + 90000
  while (performance.now() < deadline) {
    if ([...seen.values()].every((s) => s.size >= n - 1)) { done = true; break }
    await sleep(250)
  }
  const complete = [...seen.values()].filter((s) => s.size >= n - 1).length
  console.log(`  ${done ? 'everyone sees everyone' : `only ${complete}/${n} users saw all others`} after ${((performance.now() - t0) / 1000).toFixed(1)}s`)
  socks.forEach((w) => w.close())
  await sleep(1500)
}

mock.listen(MOCK_PORT)
const worker = spawn('npx', ['wrangler', 'dev', '-c', 'test/wrangler.test.jsonc', '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--inspector-port', '0',
  '--var', `APP_URL:http://localhost:${MOCK_PORT}`, '--var', `SUPABASE_URL:http://localhost:${MOCK_PORT}`, '--var', `ALLOWED_ORIGINS:${ORIGIN}`,
  '--var', `NEXTAUTH_SECRET:${SECRET}`, '--var', `INTERNAL_API_SECRET:${INTERNAL}`, '--var', 'SUPABASE_SERVICE_ROLE_KEY:svc'], { stdio: 'ignore' })

try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://${host}/health`)).ok) break } catch {} await sleep(500) }
  console.log('worker up (local workerd)')
  const [mode, a, b] = process.argv.slice(2)
  if (mode === 'hot') await hotRoom(Number(a), Number(b))
  else if (mode === 'rooms') await manyRooms(Number(a), Number(b))
  else if (mode === 'presence') await presenceSurge(Number(a))
  else {
    await hotRoom(5, 30)
    await hotRoom(10, 15)
    await hotRoom(20, 10)
    await hotRoom(40, 6)
    await manyRooms(100, 4)
  }
} catch (e) {
  console.error('LOAD TEST ERROR:', e.message)
} finally {
  worker.kill('SIGTERM'); mock.close()
  setTimeout(() => process.exit(0), 500)
}
