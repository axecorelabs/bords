/** npx tsx scripts/drag-lock.test.ts */
import { createDragLock } from '../src/lib/p2p/drag-lock'

let failures = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}

// Controllable clock + timers so the test is exact and instant
let t = 0
const timers: Array<{ at: number; fn: () => void; id: number; live: boolean }> = []
let nextId = 1
const advance = (ms: number) => {
  const target = t + ms
  for (;;) {
    const due = timers.filter((x) => x.live && x.at <= target).sort((a, b) => a.at - b.at)[0]
    if (!due) break
    t = due.at
    due.live = false
    due.fn()
  }
  t = target
}
const expired: string[] = []
const lock = createDragLock({
  ttlMs: 500,
  endGraceMs: 300,
  onExpire: (id) => expired.push(id),
  now: () => t,
  setTimer: (fn, ms) => { const e = { at: t + ms, fn, id: nextId++, live: true }; timers.push(e); return e },
  clearTimer: (h) => { (h as any).live = false },
})

console.log('lock lifecycle')
check('unknown shape is not locked', !lock.isLocked('a'))
lock.touch('a')
check('a preview locks the shape', lock.isLocked('a'))
advance(400)
check('still locked 400ms later', lock.isLocked('a'))
lock.touch('a') // drag continues
advance(400)
check('each preview extends the lock', lock.isLocked('a') && expired.length === 0)
advance(200)
check('lock released ~500ms after the LAST preview', !lock.isLocked('a'))
check('reconcile callback fires exactly once on expiry', expired.length === 1 && expired[0] === 'a', JSON.stringify(expired))

console.log('\nexplicit drag end')
expired.length = 0
lock.touch('b')
advance(100)
lock.end('b')
check('after "drag ended" the lock is kept briefly (final server update can land)', lock.isLocked('b'))
advance(250)
check('...still held inside the grace window', lock.isLocked('b'))
advance(100)
check('...then released', !lock.isLocked('b') && expired.length === 1 && expired[0] === 'b')
lock.end('never-locked')
check('ending an unlocked shape is a no-op', !lock.isLocked('never-locked') && expired.length === 1)

console.log('\nindependence + dispose')
expired.length = 0
lock.touch('x'); lock.touch('y')
advance(300)
lock.touch('x')
advance(300)
check('shapes expire independently', !lock.isLocked('y') && lock.isLocked('x') && expired.join() === 'y', expired.join())
lock.dispose()
advance(2000)
check('dispose cancels pending expiries', expired.join() === 'y' && !lock.isLocked('x'))

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exit(failures ? 1 : 0)
