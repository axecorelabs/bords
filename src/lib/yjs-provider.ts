'use client'

import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { useCollabStore } from '@/store/collabStore'
import { useBoardSyncStore } from '@/store/boardSyncStore'

const WS_URL = process.env.NEXT_PUBLIC_COLLAB_WS_URL || 'ws://localhost:4444'

const MAX_RETRIES = 5
const COOLDOWN_MS = 2 * 60 * 1000 // 2 minutes

// Per-board retry tracking
const retryState = new Map<string, { failures: number; cooldownUntil: number }>()

/**
 * Fetch a short-lived WebSocket auth ticket from the Next.js API.
 * The API uses getServerSession (which can read httpOnly cookies)
 * and returns a signed JWT valid for 5 minutes.
 */
async function fetchCollabTicket(): Promise<string> {
  try {
    console.log('[Yjs:provider] Fetching collab ticket...')
    const res = await fetch('/api/collab/ticket')
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
 * Connect to the Hocuspocus collaboration server for a specific board.
 * Creates a Y.Doc, opens HocuspocusProvider, stores refs in collabStore.
 *
 * The provider is created with `autoConnect: false` so the caller can set up
 * bindings and awareness BEFORE the WebSocket opens. Call `.connect()` on
 * the returned provider when ready.
 */
export async function connectToBoard(boardId: string): Promise<{
  ydoc: Y.Doc
  provider: HocuspocusProvider
}> {
  // Only connect to boards that have been synced to cloud
  const cloudHash = useBoardSyncStore.getState().contentHashes[boardId]
  if (!cloudHash) {
    console.warn('[Yjs:provider] Board not synced to cloud — skipping connection:', boardId)
    throw new Error('Board not synced to cloud')
  }

  // Check retry cooldown
  const state = retryState.get(boardId)
  if (state && state.failures >= MAX_RETRIES) {
    if (Date.now() < state.cooldownUntil) {
      const remaining = Math.ceil((state.cooldownUntil - Date.now()) / 1000)
      console.warn(`[Yjs:provider] Max retries (${MAX_RETRIES}) reached for ${boardId}. Cooldown: ${remaining}s remaining.`)
      throw new Error(`Connection cooldown — retry in ${remaining}s`)
    }
    // Cooldown expired — reset
    console.log('[Yjs:provider] Cooldown expired, resetting retry count for:', boardId)
    retryState.delete(boardId)
  }

  // Tear down any existing connection
  disconnectFromBoard()

  console.log('[Yjs:provider] connectToBoard called for:', boardId)
  const ydoc = new Y.Doc()

  // Verify we can get a token before creating the provider
  const initialToken = await fetchCollabTicket()
  console.log('[Yjs:provider] Creating HocuspocusProvider with URL:', WS_URL, 'room:', boardId, 'token:', initialToken ? 'present' : 'EMPTY')

  if (!initialToken) {
    console.warn('[Yjs:provider] No auth ticket — cannot connect')
    throw new Error('Failed to obtain auth ticket')
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
    // Token as async function — called on every (re)connect for fresh auth
    token: () => fetchCollabTicket(),
    onAuthenticationFailed: ({ reason }) => {
      console.warn('[Yjs:provider] Auth failed:', reason)
      useCollabStore.getState().setConnectionStatus('error')
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

  provider.on('close', ({ event }: { event: CloseEvent }) => {
    console.warn('[Yjs:provider] Connection closed for room:', boardId, 'code:', event.code)
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

  // Store refs
  useCollabStore.getState().setYjsState(ydoc, provider, boardId)
  console.log('[Yjs:provider] Provider created (autoConnect=false). Call provider.connect() to open WebSocket.')

  return { ydoc, provider }
}

/**
 * Disconnect from the current collaboration session.
 * Cleans up provider, Y.Doc, and store state.
 */
export function disconnectFromBoard() {
  useCollabStore.getState().clearYjsState()
}

/**
 * Reset retry cooldown for a board (e.g. when user manually retries).
 */
export function resetRetryCooldown(boardId: string) {
  retryState.delete(boardId)
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
