/** npx tsx scripts/cursor-positions.test.ts */
import { applyCursor, getCursorPosition, setCursorPositions, clearCursorPositions } from '../src/lib/cursor-positions'

let failures = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}
const at = (id: number) => JSON.stringify(getCursorPosition(id))

console.log('two paths, one cursor')
applyCursor(1, { x: 10, y: 10 }, 5) // direct (fast)
check('first update applies', at(1) === '{"x":10,"y":10}')
applyCursor(1, { x: 1, y: 1 }, 3) // an OLDER copy arrives late via the server
check('an older copy from the slower path is ignored', at(1) === '{"x":10,"y":10}', at(1))
applyCursor(1, { x: 10, y: 10 }, 5) // the same update arrives via the server
check('the duplicate (same seq) is ignored', at(1) === '{"x":10,"y":10}')
applyCursor(1, { x: 20, y: 20 }, 6)
check('a newer one applies from either path', at(1) === '{"x":20,"y":20}')

console.log('\nhiding')
applyCursor(1, null, 7)
check('a hide (null) with a newer seq removes the cursor', at(1) === undefined)
applyCursor(1, { x: 99, y: 99 }, 6) // stale server copy of an earlier position
check('a stale position cannot resurrect a hidden cursor', at(1) === undefined, at(1))
applyCursor(1, { x: 30, y: 30 }, 8)
check('a genuinely newer position shows it again', at(1) === '{"x":30,"y":30}')

console.log('\nsenders without sequence numbers (older clients)')
applyCursor(2, { x: 1, y: 1 })
applyCursor(2, { x: 2, y: 2 })
check('updates with no seq always apply', at(2) === '{"x":2,"y":2}')

console.log('\nawareness snapshot')
clearCursorPositions()
applyCursor(3, { x: 5, y: 5 }, 10) // direct path got ahead
setCursorPositions([
  { clientId: 3, cursor: { x: 1, y: 1, s: 4 } }, // awareness is behind (seq 4 < 10)
  { clientId: 4, cursor: { x: 7, y: 7, s: 1 } },
  { clientId: 5, cursor: null, cursorSeq: 2 },
])
check('awareness behind the direct path does not move the cursor back', at(3) === '{"x":5,"y":5}', at(3))
check('awareness supplies cursors the direct path never saw', at(4) === '{"x":7,"y":7}')
check('awareness null with a seq hides', at(5) === undefined)
setCursorPositions([{ clientId: 4, cursor: { x: 7, y: 7, s: 1 } }])
check('clients no longer in awareness are dropped', at(3) === undefined && at(4) === '{"x":7,"y":7}')

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED')
process.exit(failures ? 1 : 0)
