/**
 * collab-api.ts — REST client for the Fastify collaboration server.
 *
 * Wraps /health, /api/rooms/:boardId/connections, and
 * /api/rooms/:boardId/awareness endpoints.
 */

import { signOut } from 'next-auth/react'

const WS_URL = process.env.NEXT_PUBLIC_COLLAB_WS_URL || 'ws://localhost:4444'

/** Derive the HTTP base URL from the WebSocket URL */
function getBaseUrl(): string {
  return WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '')
}

/** Fetch a fresh auth ticket from the Next.js API */
async function getTicket(): Promise<string> {
  try {
    const res = await fetch('/api/collab/ticket', { cache: 'no-store' })
    if (res.status === 401) {
      signOut({ callbackUrl: '/login' })
      return ''
    }
    if (!res.ok) return ''
    const data = await res.json()
    return data.ticket || ''
  } catch {
    return ''
  }
}

/* ═══════════════════  Health  ═══════════════════ */

export interface ServerHealth {
  status: string
  uptime: number
  mongoStatus: string
  redisStatus: string
  roomConnections: number
}

export async function fetchServerHealth(boardId?: string): Promise<ServerHealth | null> {
  try {
    const url = new URL(`${getBaseUrl()}/health`)
    if (boardId) url.searchParams.set('boardId', boardId)
    const res = await fetch(url.toString(), {
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/* ═══════════════════  Connections  ═══════════════════ */

export interface ConnectedUser {
  userId: string
  name: string
  avatar: string | null
  permission: 'owner' | 'edit' | 'view'
  connectedAt: string
}

export interface RoomConnections {
  boardId: string
  connectedUsers: ConnectedUser[]
  totalConnections: number
}

export async function fetchRoomConnections(boardId: string): Promise<RoomConnections | null> {
  try {
    const ticket = await getTicket()
    if (!ticket) return null

    const res = await fetch(`${getBaseUrl()}/api/rooms/${encodeURIComponent(boardId)}/connections`, {
      headers: { Authorization: `Bearer ${ticket}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

/* ═══════════════════  Awareness Snapshot  ═══════════════════ */

export interface AwarenessState {
  clientId: number
  user: {
    id: string
    name: string
    color: string
  }
  cursor: { x: number; y: number } | null
  selection: string[]
  editingItem: string | null
}

export async function fetchRoomAwareness(boardId: string): Promise<AwarenessState[] | null> {
  try {
    const ticket = await getTicket()
    if (!ticket) return null

    const res = await fetch(`${getBaseUrl()}/api/rooms/${encodeURIComponent(boardId)}/awareness`, {
      headers: { Authorization: `Bearer ${ticket}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.states ?? []
  } catch {
    return null
  }
}
