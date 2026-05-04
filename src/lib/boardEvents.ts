/**
 * boardEvents — lightweight in-app event channel for board/assignment state sync.
 *
 * Handles two channels:
 *   - Same-tab:  CustomEvent on window ('bords:assignment-sync')
 *   - Cross-tab: localStorage key ('bords:assignment-sync') + storage event
 *
 * Usage:
 *   emitAssignmentSync(boardLocalId)        // fire from any action handler
 *   const off = onAssignmentSync(handler)   // subscribe; call off() to clean up
 */

export interface AssignmentSyncPayload {
  boardLocalId: string
  source?: string
  ts: number
}

const EVENT_KEY = 'bords:assignment-sync'

export function emitAssignmentSync(boardLocalId: string, source = 'client'): void {
  if (typeof window === 'undefined') return
  const payload: AssignmentSyncPayload = { boardLocalId, source, ts: Date.now() }
  // Same-tab: CustomEvent fires synchronously in the same window
  window.dispatchEvent(new CustomEvent(EVENT_KEY, { detail: payload }))
  // Cross-tab: localStorage `storage` event fires in OTHER tabs only
  try {
    localStorage.setItem(EVENT_KEY, JSON.stringify(payload))
  } catch {
    // Ignore storage quota / private-mode errors
  }
}

export function onAssignmentSync(
  handler: (payload: AssignmentSyncPayload) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}

  // Same-tab listener
  const customHandler = (e: Event) => {
    handler((e as CustomEvent<AssignmentSyncPayload>).detail)
  }

  // Cross-tab listener (storage events only fire in other tabs)
  const storageHandler = (e: StorageEvent) => {
    if (e.key !== EVENT_KEY || !e.newValue) return
    try {
      handler(JSON.parse(e.newValue) as AssignmentSyncPayload)
    } catch {
      // Ignore malformed payloads
    }
  }

  window.addEventListener(EVENT_KEY, customHandler)
  window.addEventListener('storage', storageHandler)

  return () => {
    window.removeEventListener(EVENT_KEY, customHandler)
    window.removeEventListener('storage', storageHandler)
  }
}
