/** npx tsx scripts/board-access-cache.test.ts */
import { createAccessCache, type KV } from '../src/lib/board-access-cache'

let failures = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); if (!ok) failures++ }

function fakeKv() {
  const m = new Map<string, { v: string; ex: number }>()
  const kv: KV = { get: async (k) => m.get(k)?.v ?? null, set: async (k, v, o) => void m.set(k, { v, ex: o.ex }) }
  return { kv, m }
}
async function main() {
  console.log('caching decisions')
  const { kv, m } = fakeKv()
  const c = createAccessCache(kv, { freshSeconds: 30, deniedSeconds: 5, lastKnownSeconds: 3600 })
  check('nothing cached at first', (await c.getFresh('b', 'u')) === null)
  await c.put('b', 'u', 'edit')
  check('a grant is served from the cache', (await c.getFresh('b', 'u'))?.p === 'edit')
  check('a grant is cached for the fresh window', m.get('access:b:u')?.ex === 30)
  check('...and remembered much longer as "last known" for outages', m.get('access:b:u:last')?.ex === 3600 && (await c.getLastKnown('b', 'u'))?.p === 'edit')
  await c.put('b', 'v', null)
  check('a denial is cached only briefly (so a new grant is picked up quickly)', m.get('access:b:v')?.ex === 5)
  check('a denial is NEVER banked as a last-known answer', (await c.getLastKnown('b', 'v')) === null && !m.has('access:b:v:last'))
  check('a cached denial reads back as a denial, not as a miss', (await c.getFresh('b', 'v'))?.p === null)
  check('decisions are per (board, user)', (await c.getFresh('b', 'other')) === null && (await c.getFresh('other', 'u')) === null)

  console.log('\nresilience')
  const broken: KV = { get: async () => { throw new Error('redis down') }, set: async () => { throw new Error('redis down') } }
  const bc = createAccessCache(broken)
  check('a broken cache reads as a miss instead of throwing', (await bc.getFresh('b', 'u')) === null && (await bc.getLastKnown('b', 'u')) === null)
  await bc.put('b', 'u', 'owner') // must not throw
  check('a broken cache never makes put() throw', true)
  const none = createAccessCache(null)
  await none.put('b', 'u', 'edit')
  check('with no cache configured everything is a miss', (await none.getFresh('b', 'u')) === null)
  const garbage: KV = { get: async () => 'not json {', set: async () => {} }
  check('a corrupt cache entry is ignored', (await createAccessCache(garbage).getFresh('b', 'u')) === null)
  const obj: KV = { get: async () => ({ p: 'view' }), set: async () => {} } // Upstash may hand back parsed JSON
  check('values already parsed by the Redis client work too', (await createAccessCache(obj).getFresh('b', 'u'))?.p === 'view')
}
main().catch((e) => { failures++; console.error('TEST ERROR:', e) }).finally(() => { console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED'); process.exit(failures ? 1 : 0) })
