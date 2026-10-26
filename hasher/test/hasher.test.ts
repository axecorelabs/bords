/**
 * Boots the hasher Worker under workerd and checks it speaks the protocol the app expects,
 * including that it verifies the hashes imported from Supabase.   npx tsx test/hasher.test.ts
 */
import { spawn } from 'node:child_process'
import bcrypt from 'bcryptjs'

const PORT = 8796
const base = `http://127.0.0.1:${PORT}`
let failures = 0
const check = (n: string, ok: boolean, x = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  ' + x}`); if (!ok) failures++ }
const post = async (path: string, body: unknown) => {
  const r = await fetch(base + path, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
  return { status: r.status, json: (await r.json()) as any }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const worker = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', '0'], { stdio: 'ignore' })
;(async () => {
  for (let i = 0; i < 120; i++) { try { await fetch(base); break } catch { await sleep(500) } }

  console.log('hash + verify')
  const h = await post('/hash', { password: 'Correct-horse-1' })
  check('hash returns a bcrypt cost-10 hash', h.status === 200 && /^\$2[aby]\$10\$/.test(h.json.hash), JSON.stringify(h))
  check('the correct password verifies', (await post('/verify', { password: 'Correct-horse-1', hash: h.json.hash })).json.ok === true)
  check('a wrong password does not', (await post('/verify', { password: 'wrong', hash: h.json.hash })).json.ok === false)

  console.log('\ncompatibility with the hashes imported from Supabase')
  const legacy = bcrypt.hashSync('Legacy-pass-9', 10).replace('$2b$', '$2a$') // Supabase stores $2a$10$…
  check('a Supabase-style $2a$10$ hash verifies', (await post('/verify', { password: 'Legacy-pass-9', hash: legacy })).json.ok === true)
  check('hashes made here verify with the app\'s own bcryptjs (they are interchangeable)', bcrypt.compareSync('Correct-horse-1', h.json.hash))

  console.log('\nabuse and bad input')
  check('a non-bcrypt "hash" is rejected without work', (await post('/verify', { password: 'x', hash: 'not-a-hash' })).json.ok === false)
  check('a hash with an absurd cost factor is refused (no CPU burn)', (await post('/verify', { password: 'x', hash: '$2a$31$' + 'a'.repeat(53) })).json.ok === false)
  check('an oversized password is rejected', (await post('/hash', { password: 'p'.repeat(5000) })).status === 400)
  check('missing password is a 400', (await post('/hash', {})).status === 400)
  check('invalid JSON is a 400', (await post('/hash', '{nope')).status === 400)
  check('GET is not allowed', (await fetch(base + '/hash')).status === 405)
  check('unknown paths are 404', (await post('/other', { password: 'x' })).status === 404)
})()
  .catch((e) => { failures++; console.error('TEST ERROR:', e.message) })
  .finally(() => { worker.kill('SIGTERM'); console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED'); setTimeout(() => process.exit(failures ? 1 : 0), 300) })
