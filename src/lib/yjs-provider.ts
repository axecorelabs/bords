'use client'

import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { IndexeddbPersistence } from 'y-indexeddb'
import { createClient } from '@/lib/supabase/client'
import { useCollabStore } from '@/store/collabStore'
import { startRestSave, stopRestSave } from '@/lib/yjs-rest-save'

const WS_URL = process.env.NEXT_PUBLIC_COLLAB_WS_URL || 'ws://localhost:4444'

const MAX_RETRIES = 5
const COOLDOWN_MS = 2 * 60 * 1000 // 2 minutes

// Per-board retry tracking
const retryState = new Map<string, { failures: number; cooldownUntil: number }>()

// IndexedDB persistence reference (cleaned up on disconnect)
let indexeddbProvider: IndexeddbPersistence | null = null
/**
 * Fetch a short-lived WebSocket auth ticket from the Next.js API.
 * The API uses getServerSession (which can read httpOnly cookies)
 * and returns a signed JWT valid for 5 minutes.
 */
async function fetchCollabTicket(): Promise<string> {
  try {
    console.log('[Yjs:provider] Fetching collab ticket...')
    const res = await fetch('/api/collab/ticket', { cache: 'no-store' })
    if (res.status === 401) {
      console.warn('[Yjs:provider] Session expired (401) — signing out')
      createClient().auth.signOut().then(() => window.location.assign('/login'))
      return ''
    }
    if (!res.ok) {
      console.warn('[Yjs:provider] Ticket fetch failed:', res.status, res.statusText)
      return ''
    }
    const data = await res.json()
    const ticket = data.ticket || ''
    console.log('[Yjs:provider] Got ticket:', ticket ? `${ticket.slice(0, 20)}...` : '(empty)')
    return ticket
  } catch (err) {
    console.error('[Yjs:provider] Ticket fetch error:', err)
    return ''
  }
}

/**
 * Connect to a board's Y.Doc for real-time or offline editing.
 *
 * @param boardId — local board ID
 * @param options.shared — if true, opens a WebSocket to the collab server.
 *   If false, uses REST-based persistence (no WS connection).
 *
 * Creates a Y.Doc + IndexedDB persistence (always). For shared boards, also
 * creates a HocuspocusProvider with `autoConnect: false` — the caller must
 * call `provider.configuration.websocketProvider.connect()` when ready.
 */
export async function connectToBoard(
  boardId: string,
  options: { shared?: boolean } = {}
): Promise<{
  ydoc: Y.Doc
  provider: HocuspocusProvider | null
}> {
  const { shared = true } = options

  // Tear down any existing connection (WS + REST save)
  disconnectFromBoard()

  console.log('[Yjs:provider] connectToBoard called for:', boardId)
  const ydoc = new Y.Doc()

  // ── IndexedDB persistence: loads offline state into Y.Doc ──
  // y-indexeddb automatically writes every Y.Doc update to IndexedDB
  // and on load, applies stored updates so the board is instant-available.
  // This is LOCAL-ONLY and always succeeds — the board works offline.
  indexeddbProvider = new IndexeddbPersistence(`board-${boardId}`, ydoc)
  await new Promise<void>((resolve) => {
    indexeddbProvider!.once('synced', () => {
      // Diagnostic: log what IndexedDB loaded into Y.Doc
      const mapKeys = ['stickyNotes', 'checklists', 'kanbanBoards', 'texts', 'mediaItems', 'connections', 'drawings', 'reminders', 'tables', 'richTexts']
      const itemCounts: Record<string, number> = {}
      for (const k of mapKeys) {
        itemCounts[k] = ydoc.getMap(k).size
      }
      console.log('[Yjs:provider] IndexedDB synced for board:', boardId, '— item counts:', itemCounts)
      resolve()
    })
  })

  // Store ydoc in collabStore immediately (offline-first)
  useCollabStore.getState().setYDoc(ydoc, boardId)
  console.log('[Yjs:provider] setYDoc called — collabStore.ydoc is now:', useCollabStore.getState().ydoc ? 'SET' : 'NULL')

  // ── Personal (non-shared) board: REST save, no WebSocket ──
  if (!shared) {
    console.log('[Yjs:provider] Personal board — using REST save (no WS)')
    startRestSave(ydoc, boardId)
    return { ydoc, provider: null }
  }

  // ── Shared board: Try to create WebSocket provider (may fail gracefully) ──

  // Check retry cooldown
  const state = retryState.get(boardId)
  if (state && state.failures >= MAX_RETRIES) {
    if (Date.now() < state.cooldownUntil) {
      const remaining = Math.ceil((state.cooldownUntil - Date.now()) / 1000)
      console.warn(`[Yjs:provider] In cooldown (${remaining}s remaining) — running offline for: ${boardId}`)
      return { ydoc, provider: null }
    }
    // Cooldown expired — reset
    console.log('[Yjs:provider] Cooldown expired, resetting retry count for:', boardId)
    retryState.delete(boardId)
  }

  // Try to get auth token — if it fails, board still works offline
  const initialToken = await fetchCollabTicket()
  console.log('[Yjs:provider] Creating HocuspocusProvider with URL:', WS_URL, 'room:', boardId, 'token:', initialToken ? 'present' : 'EMPTY')

  if (!initialToken) {
    console.warn('[Yjs:provider] No auth ticket — running in offline mode')
    return { ydoc, provider: null }
  }

  // Create websocket transport with autoConnect: false so we can
  // wire up bindings and awareness before the socket opens.
  // Server expects WS /ws/:boardId — include boardId in the URL path.
  const ws = new HocuspocusProviderWebsocket({
    url: `${WS_URL}/ws/${encodeURIComponent(boardId)}`,
    autoConnect: false,
    delay: 1000,
    maxDelay: 30_000,
    factor: 2,
    maxAttempts: 0, // unlimited (we manage cooldown ourselves)
  })

  const provider = new HocuspocusProvider({
    name: boardId,
    document: ydoc,
    websocketProvider: ws,
    // Token as async function — called on every (re)connect for fresh auth.
    // Must return a valid JWT string; throw to abort the connection attempt.
    token: async () => {
      const ticket = await fetchCollabTicket()
      if (!ticket) throw new Error('No auth ticket available')
      return ticket
    },
    onAuthenticationFailed: ({ reason }) => {
      console.warn('[Yjs:provider] Auth failed:', reason, '— stopping reconnect')
      useCollabStore.getState().setConnectionStatus('error')
      // Stop the reconnect loop — retrying with the same invalid session won't help.
      ws.disconnect()
    },
    onAuthenticated: () => {
      console.log('[Yjs:provider] Authenticated successfully for room:', boardId)
    },
  })

  // When passing an external websocketProvider, HocuspocusProvider doesn't
  // auto-attach (it only does when it creates the socket itself).
  // We must attach manually so status/connect/close events are forwarded.
  provider.attach()

  provider.on('status', ({ status }: { status: string }) => {
    console.log('[Yjs:provider] status:', status, 'room:', boardId)
    useCollabStore.getState().setConnectionStatus(
      status as 'connecting' | 'connected' | 'disconnected'
    )
    if (status === 'connected') {
      // Reset retry count on successful connection
      retryState.delete(boardId)
    }
  })

  provider.on('disconnect', ({ event }: { event: any }) => {
    console.warn('[Yjs:provider] disconnect event — code:', event?.code, 'reason:', event?.reason, 'room:', boardId)
  })

  provider.on('close', ({ event }: { event: CloseEvent }) => {
    console.warn('[Yjs:provider] Connection closed for room:', boardId, 'code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean)

    // Don't count normal closure (1000) or going-away (1001) as failures —
    // these happen during intentional disconnect / page navigation.
    if (event.code === 1000 || event.code === 1001) return

    const rs = retryState.get(boardId) || { failures: 0, cooldownUntil: 0 }
    rs.failures++
    if (rs.failures >= MAX_RETRIES) {
      rs.cooldownUntil = Date.now() + COOLDOWN_MS
      console.warn(`[Yjs:provider] Max retries (${MAX_RETRIES}) hit — entering ${COOLDOWN_MS / 1000}s cooldown for:`, boardId)
      // Stop reconnection attempts
      ws.disconnect()
    }
    retryState.set(boardId, rs)
    if (rs.failures >= MAX_RETRIES) {
      useCollabStore.getState().setConnectionStatus('error')
    }
  })

  // Store full collab state (replaces the earlier setYDoc call)
  useCollabStore.getState().setYjsState(ydoc, provider, boardId)
  console.log('[Yjs:provider] Provider created (autoConnect=false). Call provider.connect() to open WebSocket.')

  return { ydoc, provider }
}

/**
 * Disconnect from the current collaboration session.
 * Cleans up provider, Y.Doc, IndexedDB persistence, REST save, and store state.
 */
export function disconnectFromBoard() {
  // Stop REST save if active (flushes pending changes)
  stopRestSave()

  if (indexeddbProvider) {
    indexeddbProvider.destroy()
    indexeddbProvider = null
  }
  useCollabStore.getState().clearYjsState()
}

/**
 * Reset retry cooldown for a board (e.g. when user manually retries).
 */
export function resetRetryCooldown(boardId: string) {
  retryState.delete(boardId)
}

/**
 * Clear IndexedDB storage for a board (call when a board is deleted).
 */
export async function clearBoardIndexedDB(boardId: string) {
  try {
    const { clearDocument } = await import('y-indexeddb')
    await clearDocument(`board-${boardId}`)
  } catch {
    // IndexedDB clear failed — non-critical
  }
}

/**
 * Check if a board is in retry cooldown.
 */
export function isInCooldown(boardId: string): boolean {
  const state = retryState.get(boardId)
  if (!state || state.failures < MAX_RETRIES) return false
  return Date.now() < state.cooldownUntil
}

/**
 * Check if the collaboration server is reachable.
 * Uses a simple HTTP fetch to the /health endpoint.
 */
export async function isCollabServerAvailable(): Promise<boolean> {
  try {
    const httpUrl = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '')
    const resp = await fetch(`${httpUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return resp.ok
  } catch {
    return false
  }
}

/**
 * Upgrade a personal board to WebSocket sync (e.g. when the user shares it).
 * Flushes any pending REST saves, then reconnects with WS enabled.
 *
 * Returns the new provider (caller must set up awareness + connect).
 */
export async function upgradeToWebSocket(boardId: string): Promise<{
  ydoc: Y.Doc
  provider: HocuspocusProvider | null
}> {
  console.log('[Yjs:provider] Upgrading board to WebSocket:', boardId)
  return connectToBoard(boardId, { shared: true })
}
