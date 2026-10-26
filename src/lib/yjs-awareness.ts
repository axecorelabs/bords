'use client'

/**
 * Yjs Awareness Integration
 *
 * Manages cursor positions, user presence, and "currently editing" indicators
 * via y-protocols awareness. Each connected client broadcasts its state, and
 * remote state changes are pushed into collabStore.remoteUsers.
 */

import type { CollabProvider } from '@/lib/yjs-provider'
import { useCollabStore, type RemoteUser } from '@/store/collabStore'
import { setCursorPositions, clearCursorPositions } from '@/lib/cursor-positions'
import { startP2P, nextCursorSeq, sendP2PCursor } from '@/lib/p2p/session'

// Cursor updates are throttled per field (not globally) at ~30fps. The newest value is
// always delivered: if a call lands inside the window, a trailing send fires when it ends,
// so a cursor that stops moving never stays stuck at a stale position.
//
// The interval grows with the room. The server batches awareness updates in rooms of 7+ people
// (one combined message per person per ~40ms), so its outgoing traffic no longer grows with the
// square of the room; what still grows is how many updates arrive at the server (people x rate) and
// how many states each person must process. Load-tested locally: 120 people at 5 updates/s each
// (~71k logical relays/s) still delivered 98% with a ~60ms median delay.
const AWARENESS_BASE_MS = 33
function throttleMsFor(awareness: any): number {
  const others = Math.max(0, (awareness?.getStates?.().size ?? 1) - 1)
  if (others <= 4) return AWARENESS_BASE_MS // up to 5 people: ~30/s
  if (others <= 9) return 50 //                up to 10: ~20/s
  if (others <= 19) return 66 //               up to 20: ~15/s
  if (others <= 49) return 100 //              up to 50: ~10/s
  if (others <= 99) return 160 //              up to 100: ~6/s
  return 200 //                                 beyond: ~5/s (the receiver's easing keeps it smooth)
}
const lastSentAt = new Map<string, number>()
const pendingSends = new Map<string, { awareness: any; value: any; timer: ReturnType<typeof setTimeout> }>()

const throttledSetLocalStateField = (
  awareness: any,
  field: string,
  value: any,
  force = false
) => {
  if (!awareness) return
  const now = Date.now()
  const last = lastSentAt.get(field) ?? 0
  const pending = pendingSends.get(field)
  const interval = throttleMsFor(awareness)

  if (force || now - last >= interval) {
    if (pending) {
      clearTimeout(pending.timer)
      pendingSends.delete(field)
    }
    lastSentAt.set(field, now)
    awareness.setLocalStateField(field, value)
    return
  }

  if (pending) {
    pending.value = value
    pending.awareness = awareness
    return
  }
  const timer = setTimeout(() => {
    const queued = pendingSends.get(field)
    if (!queued) return
    pendingSends.delete(field)
    lastSentAt.set(field, Date.now())
    queued.awareness.setLocalStateField(field, queued.value)
  }, interval - (now - last))
  pendingSends.set(field, { awareness, value, timer })
}

// Stable per-session color palette — each userId gets a consistent color
const PRESENCE_COLORS = [
  '#e57373', '#f06292', '#ba68c8', '#9575cd',
  '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1',
  '#4db6ac', '#81c784', '#aed581', '#dce775',
  '#fff176', '#ffd54f', '#ffb74d', '#ff8a65',
]

function getUserColor(userId: string): string {
  let hash = 0
  for (const char of userId) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0)
    hash |= 0
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]
}

/**
 * Set up awareness broadcasting for the local user and observe remote users.
 * Returns a teardown function.
 */
export function setupAwareness(
  provider: CollabProvider,
  user: { id: string; name: string; email: string; avatar?: string | null; permission?: 'owner' | 'edit' | 'view' }
): () => void {
  const awareness = provider.awareness
  if (!awareness) {
    console.warn('[Yjs:awareness] Provider has no awareness instance')
    return () => {}
  }

  // Set local user state
  awareness.setLocalStateField('user', {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar ?? null,
    color: getUserColor(user.id),
    permission: user.permission ?? 'owner',
  })

  // Handler for remote awareness changes
  let lastSignature = ''
  const onChange = () => {
    const states = Array.from(awareness.getStates().entries())
    const remote: RemoteUser[] = states
      .filter(([clientId, state]) => {
        // Exclude our own clientId
        if (clientId === awareness.clientID) return false
        // Exclude entries without a user field (stale/empty awareness)
        if (!state.user || !state.user.id) return false
        // Exclude entries that match our own user ID
        // (stale awareness from a previous connection by the same user)
        if (state.user.id === user.id) return false
        return true
      })
      .map(([clientId, state]) => ({
        clientId,
        user: state.user,
        cursor: state.cursor ?? null,
        cursorSeq: state.cursorSeq as number | undefined,
        selection: state.selection ?? [],
        editingItem: state.editingItem ?? null,
        call: state.call ?? null,
      }))

    // Cursor positions go to their own non-React store (see cursor-positions.ts).
    setCursorPositions(remote)

    // Only touch the zustand store when something other than a cursor position changed
    // (who is here, selection, editing item, call state, or a cursor appearing/vanishing).
    const signature = JSON.stringify(
      remote.map((r) => [r.clientId, r.user, r.selection, r.editingItem, r.call, Boolean(r.cursor)])
    )
    if (signature !== lastSignature) {
      lastSignature = signature
      useCollabStore.getState().setRemoteUsers(remote)
    }
  }

  awareness.on('change', onChange)
  // Fire once to seed initial state
  onChange()

  // Direct browser-to-browser channels for cursors / drag previews (best-effort, server path stays on).
  const stopP2P = startP2P(provider as any)

  return () => {
    awareness.off('change', onChange)
    stopP2P()
    clearCursorPositions()
  }
}

/**
 * Update the local user's cursor position.
 * Call this from canvas pointer-move events.
 */
export function updateLocalCursor(
  provider: CollabProvider | null,
  cursor: { x: number; y: number } | null
) {
  if (!provider?.awareness) return
  // Every update carries a sequence number so receivers can tell which copy is newer when the same
  // cursor arrives both directly (peer-to-peer) and via the server.
  const seq = nextCursorSeq()
  sendP2PCursor(cursor, seq) // direct channels: no throttle here, callers already pace by frame
  if (cursor) {
    throttledSetLocalStateField(provider.awareness, 'cursor', { x: cursor.x, y: cursor.y, s: seq })
  } else {
    provider.awareness.setLocalState({ ...(provider.awareness.getLocalState() ?? {}), cursor: null, cursorSeq: seq })
  }
}

/**
 * Update the local user's current selection (shape IDs).
 */
export function updateLocalSelection(
  provider: CollabProvider | null,
  selection: string[]
) {
  if (!provider?.awareness) return
  throttledSetLocalStateField(provider.awareness, 'selection', selection, true) // Force: selections are discrete
}

/**
 * Update which item the local user is currently editing.
 * Set to null when editing ends.
 */
export function updateLocalEditingItem(
  provider: CollabProvider | null,
  itemId: string | null
) {
  if (!provider?.awareness) return
  throttledSetLocalStateField(provider.awareness, 'editingItem', itemId, true) // Force: discrete state change
}
