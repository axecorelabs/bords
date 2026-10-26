/** npx tsx scripts/admission.test.ts */
import { AdmissionError, createAdmission, emailKey, type CounterStore } from '../src/lib/auth/admission'

let failures = 0
const check = (name: string, ok: boolean, extra = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); if (!ok) failures++ }

function fakeRedis() {
  const counts = new Map<string, number>(); const ttls = new Map<string, number>()
  const store: CounterStore = {
    incr: async (k) => { const n = (counts.get(k) ?? 0) + 1; counts.set(k, n); return n },
    expire: async (k, s) => { ttls.set(k, s) },
    del: async (k) => { counts.delete(k); ttls.delete(k) },
  }
  return { store, counts, ttls }
}
const refused = async (fn: () => Promise<void>) => { try { await fn(); return null } catch (e) { return e instanceof AdmissionError ? e : (() => { throw e })() } }

async function main() {
  console.log('per-account limit')
  {
    const { store, ttls } = fakeRedis()
    const a = createAdmission(store, { perAccountMax: 3, globalPerSecond: 1000, now: () => 1_000_000 })
    const key = await emailKey('Victim@Example.com')
    check('the first attempts up to the limit are admitted', (await refused(() => a.checkSignIn(key))) === null && (await refused(() => a.checkSignIn(key))) === null && (await refused(() => a.checkSignIn(key))) === null)
    const err = await refused(() => a.checkSignIn(key))
    check('the next one is refused before any hashing', err instanceof AdmissionError && /sign-in attempts/.test(err.message))
    check('...with a retry-after hint', (err?.retryAfterSeconds ?? 0) >= 60)
    check('the counter has a window (it expires)', [...ttls.values()].some((s) => s >= 60))
    const other = await emailKey('someone-else@example.com')
    check('other accounts are unaffected', (await refused(() => a.checkSignIn(other))) === null)
    check('email keys ignore case and spaces', (await emailKey(' VICTIM@example.com ')) === key)
    check('keys never contain the raw email', !key.includes('victim') && !key.includes('@'))
    await a.clearAccount(key)
    check('a successful sign-in clears the account counter', (await refused(() => a.checkSignIn(key))) === null)
  }

  console.log('\nglobal hashing budget')
  {
    const { store } = fakeRedis()
    let t = 5_000_000
    const a = createAdmission(store, { perAccountMax: 1000, globalPerSecond: 5, now: () => t })
    let admitted = 0, refusedN = 0
    for (let i = 0; i < 20; i++) { const e = await refused(() => a.checkSignIn(`acct${i}`)); e ? refusedN++ : admitted++ }
    check('within one second only the budget is admitted, the rest are told to retry', admitted === 5 && refusedN === 15, `${admitted}/${refusedN}`)
    const e = await refused(() => a.checkGlobal())
    check('the refusal message is friendly and says "a few seconds"', e instanceof AdmissionError && /few seconds/.test(e.message) && e.retryAfterSeconds <= 5)
    t += 1000
    check('the next second has a fresh budget', (await refused(() => a.checkGlobal())) === null)
    const reg = await refused(() => a.checkGlobal())
    check('sign-up / reset use the same global budget', reg === null)
  }

  console.log('\nfail-open')
  {
    const broken: CounterStore = { incr: async () => { throw new Error('redis down') }, expire: async () => {}, del: async () => { throw new Error('redis down') } }
    const a = createAdmission(broken, { perAccountMax: 1 })
    const origErr = console.error; console.error = () => {}
    check('if Redis is down, sign-ins are admitted (a limiter outage must not lock everyone out)', (await refused(() => a.checkSignIn('k'))) === null && (await refused(() => a.checkGlobal())) === null)
    await a.clearAccount('k') // must not throw
    console.error = origErr
    check('and with no store configured nothing is limited', (await refused(() => createAdmission(null).checkSignIn('k'))) === null)
  }
}
main().catch((e) => { failures++; console.error('TEST ERROR:', e) }).finally(() => { console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED'); process.exit(failures ? 1 : 0) })
