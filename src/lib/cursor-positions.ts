/**
 * Latest remote cursor positions, kept OUTSIDE React state.
 *
 * Cursors move many times a second. Pushing each move through a zustand store
 * re-renders every subscriber (collaborator list, call banners, …). Instead the
 * awareness handler writes positions here and RemoteCursors reads them from its
 * own animation-frame loop, so a cursor move costs zero React renders.
 *
 * A cursor can reach us twice: directly from the other browser (peer-to-peer) and
 * through the server. Each carries a per-sender sequence number, and only a strictly
 * newer one is applied, so whichever path is faster wins and the slower, older copy
 * can never move the cursor backwards.
 */

export interface CursorPoint {
  x: number
  y: number
}

const positions = new Map<number, CursorPoint>()
const lastSeq = new Map<number, number>()

/** Apply one cursor update. `seq` undefined = sender predates sequence numbers (always apply). */
export function applyCursor(clientId: number, cursor: CursorPoint | null, seq?: number) {
  if (seq !== undefined) {
    if (seq <= (lastSeq.get(clientId) ?? -1)) return
    lastSeq.set(clientId, seq)
  }
  if (cursor) positions.set(clientId, { x: cursor.x, y: cursor.y })
  else positions.delete(clientId)
}

/** From awareness: the full set of remote clients and their latest known cursor state. */
export function setCursorPositions(
  entries: Array<{ clientId: number; cursor: (CursorPoint & { s?: number }) | null; cursorSeq?: number }>
) {
  const live = new Set<number>()
  for (const { clientId, cursor, cursorSeq } of entries) {
    live.add(clientId)
    applyCursor(clientId, cursor ? { x: cursor.x, y: cursor.y } : null, cursor?.s ?? cursorSeq)
  }
  for (const id of [...positions.keys()]) if (!live.has(id)) positions.delete(id)
  for (const id of [...lastSeq.keys()]) if (!live.has(id)) lastSeq.delete(id)
}

export function getCursorPosition(clientId: number): CursorPoint | undefined {
  return positions.get(clientId)
}

export function clearCursorPositions() {
  positions.clear()
  lastSeq.clear()
}
