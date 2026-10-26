/**
 * Behavioral test for the incremental Y.Doc -> Zustand path in lib/yjs-bindings.ts.
 *   npx tsx scripts/bindings-incremental.test.ts
 */
// Minimal browser shims (the stores persist to localStorage and the observer batches on rAF)
const mem = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
}
;(globalThis as any).window = globalThis
;(globalThis as any).addEventListener = () => {}
;(globalThis as any).removeEventListener = () => {}
;(globalThis as any).document = { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' }
;(globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0)
;(globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id)

import * as Y from 'yjs'

let failures = 0
const check = (name: string, ok: boolean, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`)
  if (!ok) failures++
}
const frame = () => new Promise((r) => setTimeout(r, 25))

async function main() {
  const { setupYjsBindings } = await import('../src/lib/yjs-bindings')
  const { useNoteStore } = await import('../src/store/stickyNoteStore')
  const { YJS_KEYS, objectToYMap } = await import('../src/lib/yjs-helpers')

  const ydoc = new Y.Doc()
  const teardown = setupYjsBindings(ydoc, 'board-1')
  const notes = ydoc.getMap(YJS_KEYS.STICKY_NOTES)
  const state = () => useNoteStore.getState().notes as any[]

  // a note that belongs to ANOTHER board must survive everything below
  useNoteStore.setState({ notes: [{ id: 'other-board-note', text: 'keep me', position: { x: 1, y: 1 } } as any] })

  console.log('add')
  notes.set('n1', objectToYMap({ id: 'n1', text: 'hello', position: { x: 10, y: 10 }, color: 'yellow' }))
  notes.set('n2', objectToYMap({ id: 'n2', text: 'second', position: { x: 50, y: 50 }, color: 'pink' }))
  await frame()
  check('new remote notes appear', state().some((n) => n.id === 'n1') && state().some((n) => n.id === 'n2'))
  check('notes from other boards untouched', state().some((n) => n.id === 'other-board-note' && n.text === 'keep me'))

  console.log('drag (position-only updates)')
  const before = state().find((n) => n.id === 'n2')
  const n1 = notes.get('n1') as Y.Map<any>
  for (let i = 1; i <= 30; i++) { n1.set('position', new Y.Map(Object.entries({ x: 10 + i, y: 10 + i }) as any)); }
  await frame()
  const moved = state().find((n) => n.id === 'n1')
  check('moved note has the latest position', moved?.position?.x === 40 && moved?.position?.y === 40, JSON.stringify(moved?.position))
  check('untouched note keeps the same object (no rebuild)', state().find((n) => n.id === 'n2') === before)
  check('other fields preserved on the moved note', moved?.text === 'hello' && moved?.color === 'yellow')

  console.log('field edit')
  n1.set('text', 'edited')
  await frame()
  check('text edit applied', state().find((n) => n.id === 'n1')?.text === 'edited')

  console.log('several items in one frame')
  ;(notes.get('n2') as Y.Map<any>).set('color', 'blue')
  n1.set('color', 'green')
  notes.set('n3', objectToYMap({ id: 'n3', text: 'third', position: { x: 0, y: 0 }, color: 'red' }))
  await frame()
  check('all three changes land', state().find((n) => n.id === 'n2')?.color === 'blue' && state().find((n) => n.id === 'n1')?.color === 'green' && state().some((n) => n.id === 'n3'))

  console.log('delete')
  notes.delete('n2')
  await frame()
  check('deleted note removed', !state().some((n) => n.id === 'n2'))
  check('others remain', state().some((n) => n.id === 'n1') && state().some((n) => n.id === 'n3') && state().some((n) => n.id === 'other-board-note'))

  console.log('replace whole item (same id)')
  notes.set('n3', objectToYMap({ id: 'n3', text: 'third v2', position: { x: 5, y: 5 }, color: 'red' }))
  await frame()
  check('replaced item reflects new content', state().find((n) => n.id === 'n3')?.text === 'third v2')

  console.log('board id list stays in sync')
  const { useBoardStore } = await import('../src/store/boardStore')
  const board = useBoardStore.getState().boards.find((b: any) => b.id === 'board-1') as any
  // boardStore may not have this board registered in the test; only assert if present
  if (board) check('board notes id array tracks adds/deletes', board.notes.includes('n1') && board.notes.includes('n3') && !board.notes.includes('n2'), JSON.stringify(board.notes))

  teardown()
}

main()
  .catch((e) => { failures++; console.error('TEST ERROR:', e) })
  .finally(() => { console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED'); process.exit(failures ? 1 : 0) })
