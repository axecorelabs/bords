'use client'

/**
 * Yjs Awareness Integration
 *
 * Manages cursor positions, user presence, and "currently editing" indicators
 * via y-protocols awareness. Each connected client broadcasts its state, and
 * remote state changes are pushed into collabStore.remoteUsers.
 */

import type { WebsocketProvider } from 'y-websocket'
import { useCollabStore, type RemoteUser } from '@/store/collabStore'

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
  provider: WebsocketProvider,
  user: { id: string; name: string; email: string; avatar?: string | null }
): () => void {
  const awareness = provider.awareness

  // Set local user state
  awareness.setLocalStateField('user', {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar ?? null,
    color: getUserColor(user.id),
  })

  // Handler for remote awareness changes
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
        selection: state.selection ?? [],
        editingItem: state.editingItem ?? null,
      }))

    useCollabStore.getState().setRemoteUsers(remote)
  }

  awareness.on('change', onChange)
  // Fire once to seed initial state
  onChange()

  return () => {
    awareness.off('change', onChange)
  }
}

/**
 * Update the local user's cursor position.
 * Call this from canvas pointer-move events.
 */
export function updateLocalCursor(
  provider: WebsocketProvider | null,
  cursor: { x: number; y: number } | null
) {
  if (!provider) return
  provider.awareness.setLocalStateField('cursor', cursor)
}

/**
 * Update the local user's current selection (shape IDs).
 */
export function updateLocalSelection(
  provider: WebsocketProvider | null,
  selection: string[]
) {
  if (!provider) return
  provider.awareness.setLocalStateField('selection', selection)
}

/**
 * Update which item the local user is currently editing.
 * Set to null when editing ends.
 */
export function updateLocalEditingItem(
  provider: WebsocketProvider | null,
  itemId: string | null
) {
  if (!provider) return
  provider.awareness.setLocalStateField('editingItem', itemId)
}
