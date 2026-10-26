/**
 * Integration test for Better Auth + the PostgREST adapter against a real
 * Postgres + PostgREST (see docs/BETTER_AUTH.md for the docker setup).
 *
 *   POSTGREST_URL=http://localhost:3002 SERVICE_KEY=<jwt> DB_CONTAINER=ba-test \
 *     npx tsx scripts/auth-integration.ts
 *
 * Expects the supabase migration 20261026000001_better_auth.sql to be applied
 * and users pw@x.dev / unv@x.dev to exist (password "Passw0rd!" for pw@x.dev).
 */
import { createServer } from 'node:net'
import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { execFileSync } from 'node:child_process'
import bcrypt from 'bcryptjs'

const POSTGREST = process.env.POSTGREST_URL ?? 'http://localhost:3002'
// Supabase's gateway serves PostgREST under /rest/v1; a bare PostgREST doesn't, so strip the prefix.
const PROXY_PORT = 3003
const URL_ = `http://localhost:${PROXY_PORT}`
const KEY = process.env.SERVICE_KEY!
const DB = process.env.DB_CONTAINER ?? 'ba-test'
const SMTP_PORT = 2526
const REDIS_PORT = 6390
const ORIGIN = 'http://localhost:3000'

process.env.NEXT_PUBLIC_SUPABASE_URL = URL_
process.env.SUPABASE_SERVICE_ROLE_KEY = KEY
process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-123456'
process.env.NEXT_PUBLIC_APP_URL = ORIGIN
process.env.GOOGLE_CLIENT_ID = 'g-id'
process.env.GOOGLE_CLIENT_SECRET = 'g-secret'
process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${REDIS_PORT}`
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake'
process.env.AUTH_HASH_PER_SECOND = '1000' // the global budget has its own unit test; keep it out of the way here
process.env.SMTP_HOST = '127.0.0.1'
process.env.SMTP_PORT = String(SMTP_PORT)
process.env.ZEPTOMAIL_SMTP_USER = 'u'
process.env.ZEPTOMAIL_SMTP_PASS = 'p'
process.env.ZEPTOMAIL_FROM_EMAIL = 'no-reply@test.dev'

const psql = (sql: string) =>
  execFileSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql]).toString().trim()

createHttpServer((req, res) => {
  const target = new globalThis.URL(POSTGREST)
  const upstream = httpRequest(
    { host: target.hostname, port: target.port, path: (req.url ?? '').replace(/^\/rest\/v1/, ''), method: req.method, headers: req.headers },
    (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res) }
  )
  req.pipe(upstream)
}).listen(PROXY_PORT)

// ── fake Upstash REST (just enough commands for rate limiting + secondary storage) ──
const kv = new Map<string, { v: string; exp?: number }>()
createHttpServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const body = JSON.parse(Buffer.concat(chunks).toString() || '[]')
  const live = (k: string) => { const e = kv.get(k); if (e?.exp && e.exp < Date.now()) { kv.delete(k); return undefined } return e }
  const run = (cmd: unknown[]): unknown => {
    const [name, key, a, b] = cmd as [string, string, any, any]
    switch (String(name).toUpperCase()) {
      case 'GET': return live(key)?.v ?? null
      case 'SET': {
        const flags = cmd.slice(3).map((x) => String(x).toUpperCase())
        if (flags.includes('NX') && live(key)) return null
        const exIdx = flags.indexOf('EX')
        kv.set(key, { v: String(a), exp: exIdx >= 0 ? Date.now() + Number(cmd[3 + exIdx + 1]) * 1000 : undefined })
        return 'OK'
      }
      case 'INCR': { const n = Number(live(key)?.v ?? 0) + 1; kv.set(key, { v: String(n), exp: live(key)?.exp }); return n }
      case 'EXPIRE': { const e = live(key); if (e) e.exp = Date.now() + Number(a) * 1000; return e ? 1 : 0 }
      case 'DEL': return kv.delete(key) ? 1 : 0
      case 'GETDEL': { const e = live(key); kv.delete(key); return e?.v ?? null }
      default: return null
    }
  }
  const isPipeline = /pipeline|multi-exec/.test(req.url ?? '')
  const out = isPipeline ? (body as unknown[][]).map((c) => ({ result: run(c) })) : { result: run(body) }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out))
}).listen(REDIS_PORT)

// ── tiny SMTP sink ───────────────────────────────────────────────────────────
const mails: { to: string; subject: string; body: string }[] = []
createServer((sock) => {
  let data = '', inData = false, rcpt = ''
  sock.write('220 sink ESMTP\r\n')
  sock.on('data', (chunk) => {
    const text = chunk.toString()
    if (inData) {
      data += text
      if (data.endsWith('\r\n.\r\n')) {
        inData = false
        const decoded = data.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
        mails.push({ to: rcpt, subject: /Subject: (.*)/.exec(decoded)?.[1] ?? '', body: decoded })
        data = ''
        sock.write('250 queued\r\n')
      }
      return
    }
    for (const line of text.split('\r\n').filter(Boolean)) {
      const u = line.toUpperCase()
      if (u.startsWith('EHLO')) sock.write('250-sink\r\n250 AUTH PLAIN LOGIN\r\n')
      else if (u.startsWith('AUTH')) sock.write('235 ok\r\n')
      else if (u.startsWith('MAIL')) sock.write('250 ok\r\n')
      else if (u.startsWith('RCPT')) { rcpt = /<(.*)>/.exec(line)?.[1] ?? ''; sock.write('250 ok\r\n') }
      else if (u === 'DATA') { inData = true; data = ''; sock.write('354 go\r\n') }
      else if (u.startsWith('QUIT')) { sock.write('221 bye\r\n'); sock.end() }
      else sock.write('250 ok\r\n')
    }
  })
}).listen(SMTP_PORT)

let failures = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => T | undefined | false, ms = 8000): Promise<T | undefined> {
  const t = Date.now()
  while (Date.now() - t < ms) { const v = fn(); if (v) return v as T; await sleep(50) }
}
const urlIn = (body: string, re: RegExp) => re.exec(body)?.[0].replace(/&amp;/g, '&')

async function main() {
  // known password for the migrated credential accounts
  const hash = await bcrypt.hash('Passw0rd!', 10)
  psql(`update ba_account set password='${hash}' where provider_id='credential' and user_id in ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333')`)
  psql(`delete from ba_session`)

  const { auth } = await import('../src/lib/auth/server')
  const call = (path: string, init: RequestInit & { json?: unknown } = {}) => {
    const headers = new Headers(init.headers)
    headers.set('origin', ORIGIN)
    if (init.json !== undefined) headers.set('content-type', 'application/json')
    return auth.handler(new Request(`${ORIGIN}/api/auth${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body }))
  }
  const cookieOf = (res: Response) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

  console.log('sign-in with migrated bcrypt hash')
  let res = await call('/sign-in/email', { method: 'POST', json: { email: 'pw@x.dev', password: 'Passw0rd!' } })
  const loginBody = await res.json()
  check('migrated verified user can sign in', res.status === 200 && loginBody.user?.id === '11111111-1111-1111-1111-111111111111', JSON.stringify(loginBody))
  const cookie = cookieOf(res)
  check('session cookie set', cookie.includes('session_token'))
  check('user id preserved (UUID)', loginBody.user.id === '11111111-1111-1111-1111-111111111111')
  res = await call('/sign-in/email', { method: 'POST', json: { email: 'pw@x.dev', password: 'wrong-password' } })
  check('wrong password rejected (401)', res.status === 401, String(res.status))
  res = await call('/sign-in/email', { method: 'POST', json: { email: 'PW@X.DEV', password: 'Passw0rd!' } })
  check('email is case-insensitive', res.status === 200, String(res.status))

  console.log('\nsession lookup')
  const sess = await auth.api.getSession({ headers: new Headers({ cookie }) })
  check('getSession returns the user from the cookie', sess?.user.email === 'pw@x.dev' && sess.user.emailVerified === true)
  check('additional fields present (first/last name)', (sess?.user as any)?.firstName === 'Pat' && (sess?.user as any)?.lastName === 'Word', JSON.stringify(sess?.user))
  const none = await auth.api.getSession({ headers: new Headers({ cookie: 'better-auth.session_token=forged.value' }) })
  check('forged cookie yields no session', none === null)
  check('sign-in login alert email sent (first time from this device)', !!(await until(() => mails.find((m) => m.to === 'pw@x.dev' && /sign-in/i.test(m.subject)))))

  console.log('\nlogin alerts only for new devices')
  {
    mails.length = 0
    const sameDevice = () => call('/sign-in/email', { method: 'POST', headers: { 'cf-connecting-ip': '198.51.100.7', 'user-agent': 'TestBrowser/1' }, json: { email: 'pw@x.dev', password: 'Passw0rd!' } })
    kv.clear() // forget devices so the first sign-in below counts as new
    mails.length = 0
    await sameDevice()
    check('a sign-in from an unseen device sends the alert', !!(await until(() => mails.find((m) => /sign-in/i.test(m.subject)))))
    await sleep(300); mails.length = 0
    await sameDevice(); await sameDevice()
    await sleep(1200)
    check('repeat sign-ins from the same device send nothing (no render, no SMTP)', mails.filter((m) => /sign-in/i.test(m.subject)).length === 0, String(mails.length))
    await call('/sign-in/email', { method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.99', 'user-agent': 'TestBrowser/1' }, json: { email: 'pw@x.dev', password: 'Passw0rd!' } })
    check('a different IP counts as a new device and alerts again', !!(await until(() => mails.find((m) => /sign-in/i.test(m.subject)))))
    await sleep(300)
    check('device keys hold no raw IP or user agent', (() => { const dk = [...kv.keys()].filter((k) => k.startsWith('auth:device:')); return dk.length >= 2 && !dk.some((k) => k.includes('198.51') || k.includes('203.0') || k.includes('TestBrowser')) })())
    mails.length = 0
  }


  console.log('\nunverified user')
  mails.length = 0
  res = await call('/sign-in/email', { method: 'POST', json: { email: 'unv@x.dev', password: 'Passw0rd!' } })
  const unvBody = await res.json()
  check('unverified user blocked with 403', res.status === 403 && /verif/i.test(JSON.stringify(unvBody)), `${res.status} ${JSON.stringify(unvBody)}`)
  check('blocked sign-in does not auto-send email (no spam vector)', !mails.some((m) => m.to === 'unv@x.dev'))
  res = await call('/send-verification-email', { method: 'POST', json: { email: 'unv@x.dev', callbackURL: '/verify-email?verified=true' } })
  check('explicit resend sends verification email', res.status === 200 && !!(await until(() => mails.find((m) => m.to === 'unv@x.dev' && /verify/i.test(m.subject)))), String(res.status))

  console.log('\nsign up + verify')
  mails.length = 0
  res = await call('/sign-up/email', { method: 'POST', json: { email: 'fresh@x.dev', password: 'Fresh-pass1', name: 'Fre Sh', firstName: 'Fre', lastName: 'Sh', callbackURL: '/verify-email?verified=true' } })
  check('sign-up accepted', res.status === 200, `${res.status} ${await res.clone().text()}`)
  check('no session until verified (autoSignIn off)', cookieOf(res) === '')
  const vmail = await until(() => mails.find((m) => m.to === 'fresh@x.dev' && /verify/i.test(m.subject)))
  check('verification email sent', !!vmail)
  check('profile + personal workspace created by DB trigger', psql(`select (select count(*) from profiles where email='fresh@x.dev')||','||(select count(*) from workspaces w join profiles p on p.id=w.owner_id where p.email='fresh@x.dev')`) === '1,1')
  check('first/last name stored on user', psql(`select first_name||'/'||last_name from ba_user where email='fresh@x.dev'`) === 'Fre/Sh')
  res = await call('/sign-in/email', { method: 'POST', json: { email: 'fresh@x.dev', password: 'Fresh-pass1' } })
  check('cannot sign in before verifying', res.status === 403)
  const vurl = urlIn(vmail!.body, /http:\/\/localhost:3000\/api\/auth\/verify-email\?[^"'\s<>]+/)
  check('verification link points at /api/auth/verify-email', !!vurl, vmail?.body.slice(0, 400))
  if (vurl) {
    const u = new URL(vurl)
    res = await call(u.pathname.replace('/api/auth', '') + u.search, { method: 'GET', redirect: 'manual' })
    check('verification link redirects to callbackURL', res.status === 302 && (res.headers.get('location') ?? '').includes('/verify-email?verified=true'), `${res.status} ${res.headers.get('location')}`)
    check('email_verified flipped to true', psql(`select email_verified from ba_user where email='fresh@x.dev'`) === 't')
    check('welcome notification created after verification', !!(await until(() => psql(`select count(*) from notifications n join profiles p on p.id=n.user_id where p.email='fresh@x.dev' and n.type='welcome'`) === '1')))
    check('welcome email sent', !!(await until(() => mails.find((m) => m.to === 'fresh@x.dev' && /welcome/i.test(m.subject)))))
  }
  res = await call('/sign-in/email', { method: 'POST', json: { email: 'fresh@x.dev', password: 'Fresh-pass1' } })
  check('can sign in after verifying', res.status === 200, String(res.status))

  console.log('\npassword reset')
  mails.length = 0
  res = await call('/request-password-reset', { method: 'POST', json: { email: 'fresh@x.dev', redirectTo: '/reset-password' } })
  check('reset request accepted', res.status === 200, String(res.status))
  const rmail = await until(() => mails.find((m) => m.to === 'fresh@x.dev' && /reset/i.test(m.subject)))
  check('reset email sent', !!rmail)
  const rurl = rmail && urlIn(rmail.body, /http:\/\/localhost:3000\/api\/auth\/reset-password\/[^"'\s<>]+/)
  check('reset link built', !!rurl, rmail?.body.slice(0, 500))
  if (rurl) {
    const u = new URL(rurl)
    res = await call(u.pathname.replace('/api/auth', '') + u.search, { method: 'GET', redirect: 'manual' })
    const loc = res.headers.get('location') ?? ''
    const token = new URL(loc, ORIGIN).searchParams.get('token')
    check('reset link redirects to /reset-password?token=…', res.status === 302 && loc.includes('/reset-password') && !!token, `${res.status} ${loc}`)
    res = await call('/reset-password', { method: 'POST', json: { newPassword: 'Brand-new2', token } })
    check('password reset succeeds', res.status === 200, `${res.status} ${await res.clone().text()}`)
    res = await call('/sign-in/email', { method: 'POST', json: { email: 'fresh@x.dev', password: 'Fresh-pass1' } })
    check('old password no longer works', res.status === 401)
    res = await call('/sign-in/email', { method: 'POST', json: { email: 'fresh@x.dev', password: 'Brand-new2' } })
    check('new password works', res.status === 200)
    res = await call('/reset-password', { method: 'POST', json: { newPassword: 'Another-3', token } })
    check('reset token is single-use', res.status !== 200)
  }

  console.log('\nadmission control (real Redis-backed limits, wired into Better Auth)')
  {
    const victim = 'pw@x.dev'
    kv.clear()
    // Each attempt comes from a different IP (a distributed attack): only the per-ACCOUNT limit can stop it
    let ipCounter = 0
    const freshIp = () => `10.9.${(ipCounter >> 8) & 255}.${ipCounter++ & 255}`
    const attempt = (password: string, email = victim) => call('/sign-in/email', { method: 'POST', headers: { 'cf-connecting-ip': freshIp() }, json: { email, password } })
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) statuses.push((await attempt('wrong-' + i)).status)
    check('the first 10 wrong guesses at one account are processed (401)', statuses.slice(0, 10).every((s) => s === 401), JSON.stringify(statuses))
    check('guess 11 onwards is refused with 429', statuses[10] === 429 && statuses[11] === 429, JSON.stringify(statuses))
    const t0 = Date.now()
    const blocked = await attempt('Passw0rd!')
    const blockedMs = Date.now() - t0
    const body = await blocked.json()
    check('even the CORRECT password is refused while the account is throttled', blocked.status === 429)
    check('the refusal explains itself and says when to retry', /Too many sign-in attempts/.test(body.message ?? '') && Number(blocked.headers.get('retry-after')) >= 60, JSON.stringify(body) + ' ' + blocked.headers.get('retry-after'))
    console.log(`  (a refused attempt took ${blockedMs}ms; a real password check takes several times that)`)
    const other = await attempt('whatever-pw', 'g@x.dev')
    check('other accounts are unaffected by the throttle', other.status !== 429, String(other.status))
    kv.clear() // window passes
    const ok = await attempt('Passw0rd!')
    check('after the window the real password works again', ok.status === 200, String(ok.status))
    for (let i = 0; i < 4; i++) await attempt('typo-' + i)
    await attempt('Passw0rd!') // success clears the counter
    const after = []
    for (let i = 0; i < 9; i++) after.push((await attempt('typo-b' + i)).status)
    check('a successful sign-in forgives earlier typos (counter reset)', after.every((s) => s === 401), JSON.stringify(after))
    kv.clear()
  }

  console.log('\nsign out / google')
  res = await call('/sign-out', { method: 'POST', headers: { cookie }, json: {} })
  check('sign-out ok', res.status === 200)
  res = await call('/sign-in/social', { method: 'POST', json: { provider: 'google', callbackURL: '/' } })
  const g = await res.json()
  check('google sign-in returns an authorize URL with our callback', typeof g.url === 'string' && g.url.includes('accounts.google.com') && decodeURIComponent(g.url).includes(`${ORIGIN}/api/auth/callback/google`), JSON.stringify(g))
}

main()
  .catch((e) => { failures++; console.error('TEST ERROR:', e) })
  .finally(() => { console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED'); process.exit(failures ? 1 : 0) })
