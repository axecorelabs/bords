// Real-browser check: two Chrome pages run the actual mesh code and connect directly to each other,
// signaling through the real Worker.   node test/browser.test.mjs
import { spawn } from 'node:child_process'
import { hkdf } from 'node:crypto'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import puppeteer from 'puppeteer-core'
import { EncryptJWT } from 'jose'

const MOCK = 9941, WORKER = 8794, PAGE = 9942
const SECRET = 's', INTERNAL = 'i'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const check = (n, ok, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + x}`); if (!ok) failures++ }

const out = await build({ entryPoints: ['test/browser/entry.ts'], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022' })
const bundle = out.outputFiles[0].text

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const chunks = []; for await (const c of req) chunks.push(c)
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null
  const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)) }
  if (url.pathname === '/api/internal/board-access') return send(200, { permission: String(body.userId).startsWith('viewer') ? 'view' : 'edit' })
  if (url.pathname === '/api/internal/board-dirty') return send(200, {})
  if (url.pathname === '/rest/v1/') return send(200, {})
  if (url.pathname === '/rest/v1/yjs_documents') return req.method === 'GET' ? send(200, []) : send(201, {})
  send(404, {})
}).listen(MOCK)
const pageServer = createServer((req, res) => {
  if (req.url === '/bundle.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(bundle) }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>p2p</title><script src="/bundle.js"></script>')
}).listen(PAGE)

const worker = spawn('npx', ['wrangler', 'dev', '-c', 'test/wrangler.test.jsonc', '--port', String(WORKER), '--ip', '127.0.0.1', '--inspector-port', '0',
  '--var', `APP_URL:http://localhost:${MOCK}`, '--var', `SUPABASE_URL:http://localhost:${MOCK}`, '--var', `ALLOWED_ORIGINS:http://localhost:${PAGE}`,
  '--var', `NEXTAUTH_SECRET:${SECRET}`, '--var', `INTERNAL_API_SECRET:${INTERNAL}`, '--var', 'SUPABASE_SERVICE_ROLE_KEY:svc'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 120; i++) { try { if ((await fetch(`http://127.0.0.1:${WORKER}/health`)).ok) break } catch {} await sleep(500) }
  const key = new Uint8Array(await promisify(hkdf)('sha256', SECRET, '', 'NextAuth.js Generated Encryption Key', 32))
  const tk = (u) => new EncryptJWT({ sub: u, email: 'a@b.c', name: u }).setProtectedHeader({ alg: 'dir', enc: 'A256GCM' }).setIssuedAt().setExpirationTime('10m').encrypt(key)

  browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns'], // plain host candidates: deterministic on one machine
  })
  const open = async (user) => {
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.log('   [page error]', e.message))
    await page.goto(`http://localhost:${PAGE}/`)
    const id = await page.evaluate(async (o) => (window).startPeer(o), { host: `127.0.0.1:${WORKER}`, room: 'browser-room', token: await tk(user) })
    return { page, id }
  }
  // wss/ws: provider picks "ws" for 127.* hosts
  const A = await open('alice'), B = await open('bob'), V = await open('viewer-vic')

  const stat = (p) => p.page.evaluate(() => (window).peer.mesh.stats())
  let ok = false
  for (let i = 0; i < 80 && !ok; i++) { await sleep(250); const s = await Promise.all([A, B, V].map(stat)); ok = s.every((x) => x.open === 2) }
  check('three real Chrome pages opened direct channels to each other', ok, JSON.stringify(await Promise.all([A, B, V].map(stat))))
  const real = await A.page.evaluate(() => typeof RTCPeerConnection + ' / ' + navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0])
  console.log('   browser:', real)

  await A.page.evaluate(() => (window).peer.mesh.sendCursor({ x: 7, y: 9 }, 1))
  await sleep(500)
  const bGot = await B.page.evaluate(() => (window).peer.got.cursors)
  check('a cursor sent in one browser arrives in another', bGot.length === 1 && bGot[0].cursor.x === 7 && bGot[0].seq === 1, JSON.stringify(bGot))

  await A.page.evaluate(() => (window).peer.mesh.sendShape({ id: 'shape:s1', x: 50, y: 60, r: 0 }))
  await V.page.evaluate(() => (window).peer.mesh.sendShape({ id: 'shape:evil', x: 1, y: 1 }))
  await sleep(700)
  const bShapes = await B.page.evaluate(() => (window).peer.got.shapes.map((s) => s.preview.id))
  check('an editor\'s shape preview arrives; a viewer\'s is rejected', bShapes.includes('shape:s1') && !bShapes.includes('shape:evil'), JSON.stringify(bShapes))

  // direct-channel latency in a real browser (loopback)
  await B.page.evaluate(() => { (window).peer.got.cursors.length = 0 })
  for (let i = 0; i < 50; i++) { await A.page.evaluate((i) => (window).peer.mesh.sendCursor({ x: i, y: performance.timeOrigin + performance.now() }, 100 + i), i); await sleep(12) }
  await sleep(400)
  const lat = await B.page.evaluate(() => (window).peer.got.cursors.map((c) => performance.timeOrigin + c.at - c.cursor.y))
  lat.sort((a, b) => a - b)
  console.log(`   direct one-way in Chrome: n=${lat.length} p50=${lat[Math.floor(lat.length / 2)]?.toFixed(1)}ms`)
  check('most of 50 rapid cursor updates arrive', lat.length >= 40, String(lat.length))

  await V.page.close()
  let closed = false
  for (let i = 0; i < 40 && !closed; i++) { await sleep(250); closed = (await stat(A)).open === 1 && (await stat(B)).open === 1 }
  check('closing a tab tears down its channels for the others', closed)
} catch (e) {
  failures++; console.error('TEST ERROR:', e.message)
} finally {
  await browser?.close(); worker.kill('SIGTERM'); mock.close(); pageServer.close()
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED'); setTimeout(() => process.exit(failures ? 1 : 0), 500)
}
