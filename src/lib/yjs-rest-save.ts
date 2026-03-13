/**
 * yjs-rest-save.ts — Client-side REST persistence for Y.Doc state.
 *
 * Used for personal (non-shared) boards that don't maintain a WebSocket
 * connection. Observes Y.Doc updates and saves to the server via REST
 * with debounce + max-interval logic.
 *
 * Timing:
 *   • 5 s debounce after last Y.Doc change (idle save)
 *   • 30 s max interval during continuous editing (forced save)
 *   • Immediate flush on beforeunload / visibilitychange (hidden)
 */

import * as Y from 'yjs'

// ── Active save session state ──
let activeYdoc: Y.Doc | null = null
let activeBoardId: string | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let lastFlushTime = 0
let dirty = false
let saving = false

const IDLE_DELAY = 5_000   // 5 s
const MAX_INTERVAL = 30_000 // 30 s

// ── Core save function ──

async function saveStateToServer(ydoc: Y.Doc, boardId: string): Promise<void> {
  const state = Y.encodeStateAsUpdate(ydoc)
  const stateVector = Y.encodeStateVector(ydoc)

  const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}/save-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: bufferToBase64(state),
      stateVector: bufferToBase64(stateVector),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || `Save failed: ${res.status}`)
  }
}

function bufferToBase64(buf: Uint8Array): string {
  // Works in both browser and Node
  let binary = ''
  for (let i = 0; i < buf.byteLength; i++) {
    binary += String.fromCharCode(buf[i])
  }
  return btoa(binary)
}

// ── Flush (immediate save) ──

async function flush(): Promise<void> {
  if (!dirty || !activeYdoc || !activeBoardId) return
  if (saving) return // Already in progress

  saving = true
  dirty = false

  try {
    await saveStateToServer(activeYdoc, activeBoardId)
    lastFlushTime = Date.now()
    console.log('[REST-save] Saved board:', activeBoardId)
  } catch (err) {
    console.error('[REST-save] Save failed:', err)
    dirty = true // Re-mark so next timer retries
  } finally {
    saving = false
  }
}

// ── Schedule save with debounce + max-interval ──

function scheduleSave(): void {
  if (!activeYdoc || !activeBoardId) return

  dirty = true

  // Clear existing debounce timer
  if (debounceTimer) clearTimeout(debounceTimer)

  // If max interval exceeded, flush immediately
  const elapsed = Date.now() - lastFlushTime
  if (elapsed >= MAX_INTERVAL) {
    flush()
    return
  }

  // Otherwise debounce
  debounceTimer = setTimeout(flush, IDLE_DELAY)
}

// ── Y.Doc update observer ──

function onYDocUpdate(_update: Uint8Array, origin: any): void {
  // Ignore updates originating from REST load (avoid save loop)
  if (origin === 'rest-load') return
  scheduleSave()
}

// ── Page lifecycle handlers ──

function onBeforeUnload(): void {
  if (!dirty || !activeYdoc || !activeBoardId) return
  // Synchronous best-effort save using sendBeacon
  try {
    const state = Y.encodeStateAsUpdate(activeYdoc)
    const stateVector = Y.encodeStateVector(activeYdoc)
    const payload = JSON.stringify({
      state: bufferToBase64(state),
      stateVector: bufferToBase64(stateVector),
    })
    navigator.sendBeacon(
      `/api/boards/${encodeURIComponent(activeBoardId)}/save-state`,
      new Blob([payload], { type: 'application/json' })
    )
    dirty = false
  } catch {
    // Best effort — browser is closing
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    flush()
  }
}

// ── Public API ──

/**
 * Start REST-based persistence for a Y.Doc.
 * Only one session can be active at a time — calling again stops the previous.
 */
export function startRestSave(ydoc: Y.Doc, boardId: string): void {
  // Stop any existing session
  stopRestSave()

  activeYdoc = ydoc
  activeBoardId = boardId
  lastFlushTime = Date.now()
  dirty = false

  // Listen for Y.Doc updates
  ydoc.on('update', onYDocUpdate)

  // Page lifecycle
  window.addEventListener('beforeunload', onBeforeUnload)
  document.addEventListener('visibilitychange', onVisibilityChange)

  console.log('[REST-save] Started for board:', boardId)
}

/**
 * Stop REST-based persistence. Flushes any pending changes.
 */
export function stopRestSave(): void {
  if (!activeYdoc) return

  const boardId = activeBoardId

  // Remove listeners
  activeYdoc.off('update', onYDocUpdate)
  window.removeEventListener('beforeunload', onBeforeUnload)
  document.removeEventListener('visibilitychange', onVisibilityChange)

  // Clear timer
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  // Final flush if dirty
  if (dirty && activeYdoc && activeBoardId) {
    // Fire-and-forget final save
    const ydoc = activeYdoc
    const bid = activeBoardId
    saveStateToServer(ydoc, bid).catch((err) =>
      console.error('[REST-save] Final flush failed:', err)
    )
  }

  activeYdoc = null
  activeBoardId = null
  dirty = false
  saving = false

  console.log('[REST-save] Stopped for board:', boardId)
}

/**
 * Check if REST save is currently active.
 */
export function isRestSaveActive(): boolean {
  return activeYdoc !== null
}

/**
 * Force an immediate save (e.g. when switching from REST to WS).
 */
export async function flushRestSave(): Promise<void> {
  await flush()
}
