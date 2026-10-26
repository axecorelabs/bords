// End-to-end test: boots the real Worker with `wrangler dev` (workerd) against a
// mock of the Next.js internal API + Supabase PostgREST, then drives it with the
// real y-partyserver client provider and raw WebSockets.
//
//   node test/e2e.mjs
import { spawn } from 'node:child_process'
import { hkdf } from 'node:crypto'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { EncryptJWT } from 'jose'
import WebSocket from 'ws'
import * as Y from 'yjs'
import YProvider from 'y-partyserver/provider'

const MOCK_PORT = 9911
const WORKER_PORT = 8791
const SECRET = 'test-nextauth-secret'
const INTERNAL = 'test-internal-secret'
const ORIGIN = 'http://localhost:3000'
const host = `localhost:${WORKER_PORT}`

// ── mock backend ─────────────────────────────────────────────────────────────
const yjsRows = new Map() // board_id -> row
const dirtyCalls = []
let accessCalls = 0
let failSaves = false // simulate a Supabase outage on writes
const members = [
  { conversation_id: 'c1', user_id: 'alice' },
  { conversation_id: 'c1', user_id: 'bob' },
  { conversation_id: 'c1', user_id: 'carol' },
]

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const chunks = []
  for await (const c of req) chunks.push(c)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null
  const send = (status, data) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)) }

  if (url.pathname === '/api/internal/board-access') {
    if (req.headers.authorization !== `Bearer ${INTERNAL}`) return send(401, { error: 'no' })
    const { userId } = body
    accessCalls++
    if (userId.startsWith('denied')) return send(200, { permission: null })
    if (userId.startsWith('viewer')) return send(200, { permission: 'view' })
    return send(200, { permission: 'edit' })
  }
  if (url.pathname === '/__fail-saves') { failSaves = url.searchParams.get('on') === '1'; return send(200, {}) }
  if (url.pathname === '/api/internal/board-dirty') { dirtyCalls.push(body); return send(200, { ok: true }) }
  if (url.pathname === '/rest/v1/' ) return send(200, {})
  if (url.pathname === '/rest/v1/yjs_documents') {
    if (req.method === 'GET') {
      const id = url.searchParams.get('board_id').replace(/^eq\./, '')
      const row = yjsRows.get(id)
      return send(200, row ? [{ state: row.state, version: row.version }] : [])
    }
    if (req.method === 'POST') {
      if (failSaves) return send(500, { error: 'simulated outage' })
      yjsRows.set(body.board_id, body)
      return send(201, {})
    }
  }
  if (url.pathname === '/rest/v1/conversation_members') {
    const uid = url.searchParams.get('user_id')
    if (uid?.startsWith('eq.')) return send(200, members.filter((m) => m.user_id === uid.slice(3)).map((m) => ({ conversation_id: m.conversation_id })))
    return send(200, members.filter((m) => !uid || m.user_id !== uid.replace(/^neq\./, '')).map((m) => ({ user_id: m.user_id })))
  }
  send(404, { error: 'mock: unknown route ' + url.pathname })
})

// ── helpers ──────────────────────────────────────────────────────────────────
const hkdfAsync = promisify(hkdf)
async function ticket(userId, { expired = false, secret = SECRET } = {}) {
  const key = new Uint8Array(await hkdfAsync('sha256', secret, '', 'NextAuth.js Generated Encryption Key', 32))
  const jwt = new EncryptJWT({ sub: userId, email: `${userId}@test.dev`, name: userId })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt(expired ? Math.floor(Date.now() / 1000) - 600 : undefined)
    .setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 300 : '5m')
  return jwt.encrypt(key)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 8000, what = 'condition') {
  const t = Date.now()
  while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(50) }
  throw new Error('timed out waiting for ' + what)
}
let failures = 0
function check(name, ok, extra = '') {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

function connectBoard(boardId, userId, opts = {}) {
  const doc = new Y.Doc()
  const provider = new YProvider(host, boardId, doc, {
    protocol: 'ws',
    prefix: `/ws/${encodeURIComponent(boardId)}`,
    WebSocketPolyfill: class extends WebSocket { constructor(u, p) { super(u, p, { headers: { Origin: ORIGIN } }) } },
    disableBc: true,
    params: async () => ({ token: opts.token ?? (await ticket(userId)) }),
  })
  const closes = []
  provider.on('connection-close', (ev) => closes.push(ev.code))
  return { doc, provider, closes }
}

function rawSocket(path, protocols) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://${host}${path}`, protocols, { headers: { Origin: ORIGIN } })
    const events = []
    ws.on('message', (d) => { const t = d.toString(); if (t === 'pong') { out.pongs++; return } events.push(JSON.parse(t)) })
    const out = { ws, events, closeCode: null, pongs: 0 }
    ws.on('close', (code) => { out.closeCode = code })
    ws.on('open', () => resolve(out))
    ws.on('error', () => resolve(out))
  })
}

// ── run ──────────────────────────────────────────────────────────────────────
mock.listen(MOCK_PORT)
const worker = spawn(
  'npx',
  ['wrangler', 'dev', '-c', 'test/wrangler.test.jsonc', '--port', String(WORKER_PORT), '--ip', '127.0.0.1', '--inspector-port', '0',
    '--var', `APP_URL:http://localhost:${MOCK_PORT}`, '--var', `SUPABASE_URL:http://localhost:${MOCK_PORT}`,
    '--var', `ALLOWED_ORIGINS:${ORIGIN}`,
    '--var', `NEXTAUTH_SECRET:${SECRET}`, '--var', `INTERNAL_API_SECRET:${INTERNAL}`, '--var', 'SUPABASE_SERVICE_ROLE_KEY:svc'],
  { stdio: ['ignore', 'pipe', 'pipe'] }
)
let workerLog = ''
worker.stdout.on('data', (d) => (workerLog += d))
worker.stderr.on('data', (d) => (workerLog += d))

try {
  await until(async () => { try { return (await fetch(`http://${host}/health`)).ok } catch { return false } }, 60000, 'worker to start')
  console.log('worker up\n')

  console.log('health + http')
  const health = await (await fetch(`http://${host}/health`)).json()
  check('GET /health ok with db connected', health.status === 'ok' && health.supabaseStatus === 'connected', JSON.stringify(health))
  check('unknown route 404', (await fetch(`http://${host}/nope`)).status === 404)

  console.log('\nboard sync')
  const a = connectBoard('board-1', 'alice')
  const b = connectBoard('board-1', 'bob')
  await until(() => a.provider.synced && b.provider.synced, 10000, 'both providers synced')
  check('both clients synced', true)

  a.doc.getMap('stickyNotes').set('n1', { text: 'hello from alice' })
  await until(() => b.doc.getMap('stickyNotes').get('n1'), 5000, 'alice edit on bob')
  check('editor edit reaches other editor', b.doc.getMap('stickyNotes').get('n1')?.text === 'hello from alice')

  a.provider.awareness.setLocalStateField('user', { id: 'alice', name: 'alice', color: '#f00' })
  await until(() => [...b.provider.awareness.getStates().values()].some((s) => s.user?.id === 'alice'), 5000, 'awareness')
  check('awareness (presence) propagates', true)

  const conns = await (await fetch(`http://${host}/api/rooms/board-1/connections`, { headers: { Authorization: `Bearer ${await ticket('alice')}`, Origin: ORIGIN } })).json()
  check('rooms/connections lists both users', conns.connectedUsers?.length === 2 && conns.totalConnections === 2, JSON.stringify(conns))
  const aw = await (await fetch(`http://${host}/api/rooms/board-1/awareness`, { headers: { Authorization: `Bearer ${await ticket('alice')}` } })).json()
  check('rooms/awareness returns states', Array.isArray(aw.states) && aw.states.some((s) => s.user?.id === 'alice'), JSON.stringify(aw))
  check('rooms endpoint rejects missing ticket', (await fetch(`http://${host}/api/rooms/board-1/connections`)).status === 401)
  check('rooms endpoint rejects denied user', (await fetch(`http://${host}/api/rooms/board-1/connections`, { headers: { Authorization: `Bearer ${await ticket('denied-x')}` } })).status === 403)

  console.log('\nread-only viewer')
  const v = connectBoard('board-1', 'viewer-1')
  await until(() => v.provider.synced, 10000, 'viewer synced')
  check('viewer receives existing content', v.doc.getMap('stickyNotes').get('n1')?.text === 'hello from alice')
  a.doc.getMap('stickyNotes').set('n2', { text: 'second' })
  await until(() => v.doc.getMap('stickyNotes').get('n2'), 5000, 'live update to viewer')
  check('viewer receives live updates', true)
  v.doc.getMap('stickyNotes').set('hacked', { text: 'viewer write' })
  await sleep(1000)
  check('viewer writes are NOT applied for others', a.doc.getMap('stickyNotes').get('hacked') === undefined && b.doc.getMap('stickyNotes').get('hacked') === undefined)

  console.log('\nauth rejection')
  const bad = connectBoard('board-1', 'x', { token: 'garbage' })
  await until(() => bad.closes.length > 0, 8000, 'bad token close')
  check('invalid ticket closes with 4001', bad.closes[0] === 4001, `got ${bad.closes[0]}`)
  const expired = connectBoard('board-1', 'x', { token: await ticket('alice', { expired: true }) })
  await until(() => expired.closes.length > 0, 8000, 'expired close')
  check('expired ticket closes with 4001', expired.closes[0] === 4001, `got ${expired.closes[0]}`)
  const wrongKey = connectBoard('board-1', 'x', { token: await ticket('alice', { secret: 'other' }) })
  await until(() => wrongKey.closes.length > 0, 8000, 'wrong key close')
  check('ticket signed with other secret closes 4001', wrongKey.closes[0] === 4001)
  const denied = connectBoard('board-1', 'denied-1')
  await until(() => denied.closes.length > 0, 8000, 'denied close')
  check('no board access closes with 4003', denied.closes[0] === 4003, `got ${denied.closes[0]}`)
  for (const c of [bad, expired, wrongKey, denied]) c.provider.destroy()
  const evil = await rawSocket('/ws/board-1?token=x', undefined)
  evil.ws.close()
  const badOrigin = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://${host}/ws/board-1?token=x`, { headers: { Origin: 'https://evil.example' } })
    ws.on('unexpected-response', (_q, res) => resolve(res.statusCode))
    ws.on('open', () => resolve('open'))
    ws.on('error', () => {})
  })
  check('disallowed Origin rejected with 403', badOrigin === 403, String(badOrigin))

  console.log('\npersistence')
  await until(() => yjsRows.has('board-1'), 12000, 'debounced save')
  check('state saved to yjs_documents (debounced)', yjsRows.get('board-1').state.startsWith('\\x'))
  check('board-dirty notified', dirtyCalls.some((c) => c.boardIds?.[0] === 'board-1'))
  check('last_modified_by recorded', ['alice', 'bob'].includes(yjsRows.get('board-1').last_modified_by), yjsRows.get('board-1').last_modified_by)
  for (const c of [a, b, v]) c.provider.destroy()
  await sleep(500)
  // persisted bytea decodes to the expected doc
  const restored = new Y.Doc()
  Y.applyUpdate(restored, Buffer.from(yjsRows.get('board-1').state.slice(2), 'hex'))
  check('persisted bytea decodes to the board', restored.getMap('stickyNotes').get('n2')?.text === 'second' && !restored.getMap('stickyNotes').get('hacked'))

  // fresh room loads from "Supabase" on first connect
  const seeded = new Y.Doc(); seeded.getMap('texts').set('t1', { v: 'seed' })
  yjsRows.set('board-seeded', { state: '\\x' + Buffer.from(Y.encodeStateAsUpdate(seeded)).toString('hex'), version: 7 })
  const s = connectBoard('board-seeded', 'alice')
  await until(() => s.provider.synced, 10000, 'seeded sync')
  check('new room loads existing state from yjs_documents', s.doc.getMap('texts').get('t1')?.v === 'seed')
  s.doc.getMap('texts').set('t2', { v: 'edit' })
  await sleep(400)
  s.provider.destroy() // last one out -> immediate flush, no debounce wait
  await until(() => yjsRows.get('board-seeded')?.version === 8, 5000, 'flush on last disconnect')
  check('flush on last disconnect bumps version (7 -> 8)', true)

  console.log('\nhibernation (idle 15s with sockets open)')
  const h1 = connectBoard('board-hib', 'alice')
  const h2 = connectBoard('board-hib', 'bob')
  await until(() => h1.provider.synced && h2.provider.synced, 10000, 'hib sync')
  h1.doc.getMap('m').set('before', 1)
  await until(() => h2.doc.getMap('m').get('before'), 5000, 'pre-idle sync')
  await until(() => yjsRows.has('board-hib'), 12000, 'pre-idle save')
  await sleep(15000) // > 10s: DO is evicted from memory, sockets stay attached
  h2.doc.getMap('m').set('after', 2)
  await until(() => h1.doc.getMap('m').get('after'), 8000, 'post-idle sync')
  check('edit after hibernation still syncs between existing clients', h1.doc.getMap('m').get('after') === 2)
  const h3 = connectBoard('board-hib', 'carol')
  await until(() => h3.provider.synced, 10000, 'late joiner')
  await sleep(500)
  check('late joiner after hibernation sees full state', h3.doc.getMap('m').get('before') === 1 && h3.doc.getMap('m').get('after') === 2)
  await until(() => { const r = yjsRows.get('board-hib'); if (!r) return false; const d = new Y.Doc(); Y.applyUpdate(d, Buffer.from(r.state.slice(2), 'hex')); return d.getMap('m').get('after') === 2 }, 12000, 'post-wake save')
  check('post-wake edits persisted', true)
  for (const c of [h1, h2, h3]) c.provider.destroy()

  console.log('\nbatched awareness in a bigger room (8 people)')
  {
    const room = Array.from({ length: 8 }, (_, i) => connectBoard('board-batch', `batch-user-${i}`))
    await until(() => room.every((c) => c.provider.synced), 15000, 'batch sync')
    room.forEach((c, i) => c.provider.awareness.setLocalStateField('user', { id: `batch-user-${i}`, name: `U${i}`, color: '#123' }))
    await sleep(300)
    room[0].provider.awareness.setLocalStateField('cursor', { x: 11, y: 22 })
    room[3].provider.awareness.setLocalStateField('cursor', { x: 33, y: 44 })
    const see = (c, owner, x, y) => [...c.provider.awareness.getStates()].some(([id, st]) => id === room[owner].doc.clientID && st.cursor?.x === x && st.cursor?.y === y)
    await until(() => room.slice(1).every((c) => see(c, 0, 11, 22)) && room.filter((_, i) => i !== 3).every((c) => see(c, 3, 33, 44)), 5000, 'batched cursors')
    check('every person sees both cursors with the right values', true)
    // rapid updates coalesce, but the LAST value always arrives
    for (let i = 1; i <= 50; i++) room[0].provider.awareness.setLocalStateField('cursor', { x: i, y: i })
    await until(() => room.slice(1).every((c) => see(c, 0, 50, 50)), 5000, 'last value')
    check('after a burst of 50 updates, everyone has the final one', true)
    // leaving removes the state for everyone
    const leaverId = room[7].doc.clientID
    room[7].provider.destroy()
    await until(() => room.slice(0, 7).every((c) => !c.provider.awareness.getStates().has(leaverId)), 8000, 'leaver removed')
    check('a person who leaves disappears from everyone', true)
    room.slice(0, 7).forEach((c) => c.provider.destroy())
  }

  console.log('\nWebRTC signaling relay')
  {
    const pa = connectBoard('board-rtc', 'rtc-alice')
    const pb = connectBoard('board-rtc', 'rtc-bob')
    const pv = connectBoard('board-rtc', 'viewer-rtc')
    const pc = connectBoard('board-rtc', 'rtc-carol')
    await until(() => [pa, pb, pv, pc].every((c) => c.provider.synced), 15000, 'rtc sync')
    ;[pa, pb, pv, pc].forEach((c, i) => c.provider.awareness.setLocalStateField('user', { id: `u${i}`, name: `U${i}`, color: '#000' }))
    await sleep(500)
    const inbox = (c) => { const got = []; c.provider.on('custom-message', (m) => { try { const j = JSON.parse(m); if (j.type === 'rtc') got.push(j) } catch {} }); return got }
    const bobGot = inbox(pb), carolGot = inbox(pc), aliceGot = inbox(pa)
    const send = (c, msg) => c.provider.sendMessage(JSON.stringify(msg))
    const A = pa.doc.clientID, B = pb.doc.clientID, C = pc.doc.clientID, V = pv.doc.clientID

    send(pa, { type: 'rtc', kind: 'offer', from: A, to: B, data: { sdp: 'x' } })
    await until(() => bobGot.length >= 1, 5000, 'offer relayed')
    check('offer reaches only the target', bobGot[0].kind === 'offer' && bobGot[0].data.sdp === 'x' && carolGot.length === 0 && aliceGot.length === 0)
    check('server stamps the sender identity', bobGot[0].fromUser === 'rtc-alice', JSON.stringify(bobGot[0]))
    check('server stamps the sender permission', bobGot[0].perm === 'edit', bobGot[0].perm)

    send(pv, { type: 'rtc', kind: 'offer', from: V, to: B, data: {} })
    await until(() => bobGot.length >= 2, 5000, 'viewer offer relayed')
    check('a viewer is stamped as view (receivers can then ignore its edits)', bobGot[1].perm === 'view' && bobGot[1].fromUser === 'viewer-rtc', JSON.stringify(bobGot[1]))

    send(pa, { type: 'rtc', kind: 'offer', from: C, to: B, data: {} }) // claims to be carol
    send(pa, { type: 'rtc', kind: 'offer', from: A, to: 999999, data: {} }) // nobody there
    send(pa, { type: 'rtc', kind: 'weird', from: A, to: B, data: {} }) // unknown kind
    pa.provider.sendMessage('not json at all')
    send(pa, { type: 'rtc', kind: 'ice', from: A, to: B, data: { blob: 'x'.repeat(20000) } }) // too big
    await sleep(600)
    check('spoofed sender id, unknown target, bad kind, junk and oversize are all dropped', bobGot.length === 2 && carolGot.length === 0, `bob=${bobGot.length}`)

    for (let i = 0; i < 300; i++) send(pa, { type: 'rtc', kind: 'ice', from: A, to: B, data: { i } })
    await sleep(1500)
    check('a flood is rate-limited', bobGot.length < 2 + 200, `bob received ${bobGot.length}`)
    check('...but some legitimate traffic still passes', bobGot.length > 10)
    ;[pa, pb, pv, pc].forEach((c) => c.provider.destroy())
  }

  console.log('\nconnect storm: access checks are cached and shared')
  {
    const before = accessCalls
    const storm = Array.from({ length: 8 }, () => connectBoard('board-storm', 'storm-user'))
    await until(() => storm.every((c) => c.provider.synced), 15000, 'storm sync')
    check('8 simultaneous connects -> 1 access lookup', accessCalls - before === 1, `${accessCalls - before} lookups`)
    for (const c of storm) c.provider.destroy()
    await sleep(300)
    const again = connectBoard('board-storm', 'storm-user')
    await until(() => again.provider.synced, 10000, 'storm reconnect')
    check('reconnect inside the window needs no new lookup', accessCalls - before === 1, `${accessCalls - before} lookups`)
    again.provider.destroy()
    const other = connectBoard('board-storm-2', 'storm-user')
    await until(() => other.provider.synced, 10000, 'storm other board')
    check('a different board is looked up separately', accessCalls - before === 2, `${accessCalls - before} lookups`)
    other.provider.destroy()
  }

  console.log('\ndurability: Supabase outage + eviction')
  await fetch(`http://localhost:${MOCK_PORT}/__fail-saves?on=1`)
  const d1 = connectBoard('board-dur', 'alice')
  await until(() => d1.provider.synced, 10000, 'dur sync')
  d1.doc.getMap('m').set('precious', 'edit made during the outage')
  await sleep(1500)
  d1.provider.destroy() // last one out: the flush fails because Supabase is "down"
  await sleep(200)
  check('nothing reached Supabase while it was down', !yjsRows.has('board-dur'))
  await sleep(14000) // > 10s idle: the object is evicted from memory
  await fetch(`http://localhost:${MOCK_PORT}/__fail-saves?on=0`)
  await until(() => yjsRows.has('board-dur'), 20000, 'alarm-driven retry save')
  check('retry alarm saved it after recovery, with nobody connected', true)
  const durDoc = new Y.Doc()
  Y.applyUpdate(durDoc, Buffer.from(yjsRows.get('board-dur').state.slice(2), 'hex'))
  check('saved snapshot contains the outage-time edit', durDoc.getMap('m').get('precious') === 'edit made during the outage')
  const d2 = connectBoard('board-dur', 'bob')
  await until(() => d2.provider.synced, 10000, 'dur reload')
  await sleep(300)
  check('a later joiner sees the edit', d2.doc.getMap('m').get('precious') === 'edit made during the outage')
  d2.provider.destroy()

  // Same outage, but the object restarts and the edit exists ONLY in its journal when a client reconnects
  await fetch(`http://localhost:${MOCK_PORT}/__fail-saves?on=1`)
  const d3 = connectBoard('board-dur2', 'alice')
  await until(() => d3.provider.synced, 10000, 'dur2 sync')
  d3.doc.getMap('m').set('only-in-journal', 42)
  await sleep(1500)
  d3.provider.destroy()
  await sleep(14000) // evicted
  const d4 = connectBoard('board-dur2', 'bob')
  await until(() => d4.provider.synced, 10000, 'dur2 reload')
  await sleep(300)
  check('reloaded from the journal while Supabase is still down', d4.doc.getMap('m').get('only-in-journal') === 42)
  d4.provider.destroy()
  await fetch(`http://localhost:${MOCK_PORT}/__fail-saves?on=0`)

  console.log('\nmessaging')
  const t = (u) => ticket(u)
  const alice = await rawSocket('/messaging', ['bords-messaging', await t('alice')])
  await until(() => alice.events.some((e) => e.type === 'connected'), 5000, 'alice connected')
  check('messaging connected ack', alice.events[0].userId === 'alice' && alice.ws.protocol === 'bords-messaging')
  const bob = await rawSocket('/messaging', ['bords-messaging', await t('bob')])
  await until(() => bob.events.some((e) => e.type === 'connected'), 5000, 'bob connected')
  await until(() => alice.events.some((e) => e.type === 'presence_update' && e.userId === 'bob' && e.online), 5000, 'presence of bob to alice')
  check('presence: alice sees bob come online', true)
  await until(() => bob.events.some((e) => e.type === 'presence_update' && e.userId === 'alice' && e.online), 5000, 'presence snapshot to bob')
  check('presence: bob gets snapshot of alice', true)

  alice.ws.send(JSON.stringify({ type: 'subscribe_conversation', conversationId: 'c1' }))
  await until(() => alice.events.some((e) => e.type === 'subscribed'), 5000, 'subscribed ack')
  check('subscribe ack', true)

  const emit = (body) => fetch(`http://${host}/messaging/emit`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${INTERNAL}` }, body: JSON.stringify(body) })
  const payload = { id: 'm1', conversation_id: 'c1', sender_id: 'carol', sender_name: 'carol', content: 'hi', created_at: '2026-01-01T00:00:00Z' }
  check('emit without secret is 401', (await fetch(`http://${host}/messaging/emit`, { method: 'POST', body: '{}' })).status === 401)
  check('emit with bad payload is 400', (await emit({ type: 'new_message' })).status === 400)
  const er = await emit({ type: 'new_message', conversationId: 'c1', memberIds: ['alice', 'bob', 'carol'], senderId: 'carol', payload })
  check('emit accepted', er.ok)
  await until(() => alice.events.some((e) => e.type === 'new_message'), 5000, 'alice new_message')
  check('subscribed member gets new_message', alice.events.find((e) => e.type === 'new_message').payload.id === 'm1')
  check('subscribed member also gets badge_update', alice.events.some((e) => e.type === 'badge_update' && e.lastMessage.id === 'm1' && e.lastMessage.senderId === 'carol'))
  await until(() => bob.events.some((e) => e.type === 'badge_update'), 5000, 'bob badge')
  check('unsubscribed member gets only badge_update', !bob.events.some((e) => e.type === 'new_message') && bob.events.some((e) => e.type === 'badge_update'))

  await emit({ type: 'update_message', conversationId: 'c1', memberIds: ['alice', 'bob'], senderId: 'bob', payload: { id: 'm1', conversation_id: 'c1', reactions: [] } })
  await until(() => alice.events.some((e) => e.type === 'update_message'), 5000, 'update_message')
  check('update_message only to subscribed sockets', !bob.events.some((e) => e.type === 'update_message'))

  alice.ws.send(JSON.stringify({ type: 'unsubscribe_conversation', conversationId: 'c1' }))
  await sleep(200)
  const before = alice.events.filter((e) => e.type === 'new_message').length
  await emit({ type: 'new_message', conversationId: 'c1', memberIds: ['alice'], senderId: 'carol', payload: { ...payload, id: 'm2' } })
  await sleep(500)
  check('unsubscribe stops new_message delivery', alice.events.filter((e) => e.type === 'new_message').length === before)

  alice.ws.send('ping')
  await until(() => alice.pongs > 0, 3000, 'pong').catch(() => {})
  check('text ping is answered with pong', alice.pongs === 1, String(alice.pongs))

  const noAuth = await rawSocket('/messaging', ['bords-messaging', 'bad-ticket'])
  await until(() => noAuth.closeCode !== null, 5000, 'bad messaging close')
  check('messaging with bad ticket closes 4001', noAuth.closeCode === 4001, String(noAuth.closeCode))

  console.log('\ndb-pushed events (/events)')
  const evt = (body) => fetch(`http://${host}/events`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${INTERNAL}` }, body: JSON.stringify(body) })
  check('/events without secret is 401', (await fetch(`http://${host}/events`, { method: 'POST', body: '{}' })).status === 401)
  check('/events unsupported table is 400', (await evt({ table: 'nope', op: 'INSERT', record: {} })).status === 400)
  await evt({ table: 'notifications', op: 'INSERT', record: { user_id: 'bob', id: 'n1' } })
  await until(() => bob.events.some((e) => e.type === 'notification_change'), 5000, 'notification_change')
  check('notification row change reaches that user only', bob.events.some((e) => e.type === 'notification_change') && !alice.events.some((e) => e.type === 'notification_change'))

  const cv = connectBoard('board-comments', 'alice')
  const customs = []
  cv.provider.on('custom-message', (m) => customs.push(JSON.parse(m)))
  await until(() => cv.provider.synced, 10000, 'comment room sync')
  await evt({ table: 'board_comments', op: 'INSERT', record: { id: 'c1', board_id: 'board-comments', content: 'hi' } })
  await evt({ table: 'board_comments', op: 'DELETE', old: { id: 'c1', board_id: 'board-comments' } })
  await until(() => customs.length >= 2, 5000, 'comment events')
  check('comment insert reaches board room clients', customs[0]?.type === 'comment_insert' && customs[0].row.id === 'c1')
  check('comment delete reaches board room clients', customs[1]?.type === 'comment_delete' && customs[1].id === 'c1')
  cv.provider.destroy()

  bob.ws.close()
  await until(() => alice.events.some((e) => e.type === 'presence_update' && e.userId === 'bob' && e.online === false), 8000, 'bob offline presence')
  check('presence: alice sees bob go offline', true)
  alice.ws.close()
} catch (err) {
  failures++
  console.error('\nTEST ERROR:', err.message)
  console.error('--- worker log ---\n' + workerLog.split('\n').filter((l) => !l.includes('wrangler:info')).slice(-60).join('\n'))
} finally {
  worker.kill('SIGTERM')
  mock.close()
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
  setTimeout(() => process.exit(failures ? 1 : 0), 500)
}
