/**
 * Timing test for lib/geo-throttle.ts (the sender side of live drag sync).
 *   npx tsx scripts/geo-throttle.test.ts
 */
import { createGeoThrottle } from '../src/lib/geo-throttle'

let failures = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Delivery = { t: number; id: string; updates: Record<string, any> }

function setup() {
  const deliveries: Delivery[] = []
  const t0 = performance.now()
  const throttle = createGeoThrottle({
    intervalMs: 33,
    geoFields: new Set(['position', 'width', 'height', 'w', 'h']),
    run: (id, updates, fn) => fn(id, updates),
  })
  const fn = (id: string, updates: Record<string, any>) => deliveries.push({ t: performance.now() - t0, id, updates })
  return { throttle, deliveries, fn, t0 }
}

async function main() {
  console.log('continuous 60fps drag for ~400ms')
  {
    const { throttle, deliveries, fn } = setup()
    for (let i = 1; i <= 24; i++) {
      throttle.apply('n1', { position: { x: i, y: i } }, fn)
      await sleep(16)
    }
    const during = deliveries.length
    check('first move is sent immediately (leading edge)', deliveries[0]?.t < 5, `t=${deliveries[0]?.t}`)
    check('updates flow DURING the drag, not only at the end', during >= 8, `only ${during} deliveries in ~400ms`)
    check('rate is throttled (well below 60/s)', during <= 16, `${during} deliveries`)
    await sleep(80)
    const last = deliveries[deliveries.length - 1]
    check('final position is always delivered (trailing edge)', last.updates.position.x === 24, JSON.stringify(last.updates))
    const gaps = deliveries.slice(1).map((d, i) => d.t - deliveries[i].t)
    check('no gap longer than ~2 intervals while dragging', Math.max(...gaps.slice(0, -1)) < 90, `max gap ${Math.max(...gaps).toFixed(0)}ms`)
    await sleep(100)
    const n = deliveries.length
    await sleep(100)
    check('nothing keeps firing after the drag stops', deliveries.length === n)
  }

  console.log('\ncontent change merges queued geometry')
  {
    const { throttle, deliveries, fn } = setup()
    throttle.apply('n1', { position: { x: 1, y: 1 } }, fn) // leading
    throttle.apply('n1', { position: { x: 2, y: 2 } }, fn) // queued
    throttle.apply('n1', { text: 'hello' }, fn) // content: flush now
    const last = deliveries[deliveries.length - 1]
    check('content change sent immediately', last.updates.text === 'hello')
    check('queued position was merged, not lost', last.updates.position?.x === 2, JSON.stringify(last.updates))
    await sleep(80)
    check('no duplicate trailing send afterwards', deliveries.length === 2, `${deliveries.length} deliveries`)
  }

  console.log('\nitems are independent')
  {
    const { throttle, deliveries, fn } = setup()
    throttle.apply('a', { position: { x: 1, y: 1 } }, fn)
    throttle.apply('b', { position: { x: 9, y: 9 } }, fn)
    check('two items each get their own leading send', deliveries.filter((d) => d.id === 'a').length === 1 && deliveries.filter((d) => d.id === 'b').length === 1)
    throttle.apply('a', { position: { x: 2, y: 2 } }, fn)
    await sleep(70)
    check("b's pending state isn't affected by a", deliveries.filter((d) => d.id === 'b').length === 1)
    check('a trailing send delivered', deliveries.filter((d) => d.id === 'a').pop()?.updates.position.x === 2)
  }

  console.log('\nresize (w/h) is throttled like position')
  {
    const { throttle, deliveries, fn } = setup()
    for (let i = 0; i < 10; i++) { throttle.apply('n1', { width: 100 + i, height: 80 + i }, fn); await sleep(16) }
    await sleep(80)
    check('final size delivered', deliveries[deliveries.length - 1].updates.width === 109)
    check('multiple updates during the resize', deliveries.length >= 3, `${deliveries.length}`)
  }

  console.log('\nflush')
  {
    const { throttle, deliveries, fn } = setup()
    throttle.apply('n1', { position: { x: 1, y: 1 } }, fn)
    throttle.apply('n1', { position: { x: 7, y: 7 } }, fn)
    throttle.flush()
    check('flush delivers the queued position immediately', deliveries.length === 2 && deliveries[1].updates.position.x === 7)
    throttle.dispose()
    await sleep(60)
    check('nothing extra after flush + dispose', deliveries.length === 2)
  }

  console.log('\ndrop / dispose')
  {
    const { throttle, deliveries, fn } = setup()
    throttle.apply('n1', { position: { x: 1, y: 1 } }, fn)
    throttle.apply('n1', { position: { x: 2, y: 2 } }, fn)
    throttle.drop('n1')
    await sleep(80)
    check('drop cancels the queued trailing send', deliveries.length === 1)
    throttle.apply('n2', { position: { x: 1, y: 1 } }, fn)
    throttle.apply('n2', { position: { x: 2, y: 2 } }, fn)
    throttle.dispose()
    await sleep(80)
    check('dispose cancels everything', deliveries.length === 2)
  }
}

main()
  .catch((e) => { failures++; console.error('TEST ERROR:', e) })
  .finally(() => { console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED'); process.exit(failures ? 1 : 0) })
