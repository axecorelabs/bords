import { getServerByName } from 'partyserver'
import { checkInternalAuth, verifyTicket, type TicketClaims } from './auth'
import { BoardRoom, IDENTITY_HEADERS, type BoardPermission } from './board-room'
import { MessagingHub, MESSAGING_PROTOCOL, type DeliverEvent } from './messaging-hub'
import { PresenceRegistry } from './presence-registry'

export { BoardRoom, MessagingHub, PresenceRegistry }

// Workers freeze Date.now() at module load, so record the time of the first request instead.
let startedAt = 0
const MAX_EMIT_RECIPIENTS = 500

// ── helpers ──────────────────────────────────────────────────────────────────

function allowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin')
  if (!origin || !allowedOrigins(env).includes(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(request: Request, env: Env, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(request, env) })
}

/**
 * Browsers can't read an HTTP status from a failed WebSocket handshake, so
 * auth failures are delivered as a close code (4001 = bad/expired ticket,
 * 4003 = no access) the client can act on instead of reconnecting forever.
 */
function rejectSocket(code: number, reason: string, protocol?: string): Response {
  const { 0: client, 1: server } = new WebSocketPair()
  server.accept()
  server.close(code, reason)
  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: protocol ? { 'Sec-WebSocket-Protocol': protocol } : undefined,
  })
}

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin')
  return !origin || allowedOrigins(env).includes(origin)
}

function bearer(request: Request): string | null {
  const h = request.headers.get('Authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

// Short-lived per-isolate cache of access decisions. When a deploy or an outage makes every client
// reconnect at once, each reconnect would otherwise cost several Supabase queries; this collapses
// them to one per (user, board) per window. Grants are cached longer than denials so a person who was
// just given access isn't locked out for long, and revoking access takes effect within ACCESS_TTL_MS
// (the 5-minute ticket already bounds it on reconnect).
const ACCESS_TTL_MS = 30_000
const DENIED_TTL_MS = 3_000
const ACCESS_CACHE_MAX = 5_000
const accessCache = new Map<string, { permission: BoardPermission | null; expires: number }>()
const inflightAccess = new Map<string, Promise<BoardPermission | null>>()

async function getBoardPermission(env: Env, boardId: string, userId: string): Promise<BoardPermission | null> {
  const key = `${userId}\u0000${boardId}`
  const now = Date.now()

  const hit = accessCache.get(key)
  if (hit && hit.expires > now) return hit.permission

  // Concurrent connects for the same (user, board) share one lookup.
  const pending = inflightAccess.get(key)
  if (pending) return pending

  const lookup = fetchBoardPermission(env, boardId, userId)
    .then((permission) => {
      if (accessCache.size >= ACCESS_CACHE_MAX) {
        // Drop the oldest entry (Map keeps insertion order).
        const oldest = accessCache.keys().next().value
        if (oldest !== undefined) accessCache.delete(oldest)
      }
      accessCache.set(key, { permission, expires: Date.now() + (permission ? ACCESS_TTL_MS : DENIED_TTL_MS) })
      return permission
    })
    .finally(() => inflightAccess.delete(key))
  inflightAccess.set(key, lookup)
  return lookup
}

/** Asks the Next.js app (the single owner of the permission rules) what `userId` may do on `boardId`. */
async function fetchBoardPermission(env: Env, boardId: string, userId: string): Promise<BoardPermission | null> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.INTERNAL_API_SECRET}` },
    body: JSON.stringify({ boardId, userId }),
  }
  try {
    const res = env.APP
      ? await env.APP.fetch('https://app.internal/api/internal/board-access', init)
      : await fetch(`${env.APP_URL}/api/internal/board-access`, init)
    if (!res.ok) return null
    const data = (await res.json()) as { permission: BoardPermission | null }
    return data.permission ?? null
  } catch (err) {
    console.error('board-access check failed:', err)
    return null
  }
}

function withIdentity(request: Request, claims: TicketClaims, permission?: BoardPermission): Headers {
  const headers = new Headers(request.headers)
  // Never trust identity headers supplied by the client.
  for (const h of Object.values(IDENTITY_HEADERS)) headers.delete(h)
  headers.set(IDENTITY_HEADERS.userId, claims.userId)
  headers.set(IDENTITY_HEADERS.name, claims.name)
  headers.set(IDENTITY_HEADERS.email, claims.email)
  if (permission) headers.set(IDENTITY_HEADERS.permission, permission)
  return headers
}

// ── routes ───────────────────────────────────────────────────────────────────

async function handleBoardSocket(request: Request, env: Env, boardId: string): Promise<Response> {
  if (!originAllowed(request, env)) return new Response('Forbidden origin', { status: 403 })

  const url = new URL(request.url)
  const claims = await verifyTicket(url.searchParams.get('token'), env.NEXTAUTH_SECRET)
  if (!claims) return rejectSocket(4001, 'unauthorized')

  const permission = await getBoardPermission(env, boardId, claims.userId)
  if (!permission) return rejectSocket(4003, 'forbidden')

  // Keep the ticket out of the Durable Object (it persists the connection URL).
  url.searchParams.delete('token')
  const stub = await getServerByName(env.BOARD_ROOM, boardId)
  return stub.fetch(new Request(url, { headers: withIdentity(request, claims, permission) }))
}

async function handleMessagingSocket(request: Request, env: Env): Promise<Response> {
  if (!originAllowed(request, env)) return new Response('Forbidden origin', { status: 403 })

  // Ticket travels in Sec-WebSocket-Protocol so it never lands in URLs/logs:
  //   new WebSocket(url, ['bords-messaging', ticket])
  const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim())
  if (offered[0] !== MESSAGING_PROTOCOL) return rejectSocket(4001, 'unauthorized')
  const claims = await verifyTicket(offered[1], env.NEXTAUTH_SECRET)
  if (!claims) return rejectSocket(4001, 'unauthorized', MESSAGING_PROTOCOL)

  const headers = withIdentity(request, claims)
  headers.delete('Sec-WebSocket-Protocol')
  const hub = env.MESSAGING_HUB.get(env.MESSAGING_HUB.idFromName(claims.userId))
  return hub.fetch(new Request(request.url, { headers }))
}

async function handleEmit(request: Request, env: Env): Promise<Response> {
  if (!checkInternalAuth(request, env.INTERNAL_API_SECRET)) return json(request, env, { error: 'Unauthorized' }, 401)

  let body: {
    type?: string
    conversationId?: string
    memberIds?: unknown
    senderId?: string
    payload?: Record<string, unknown>
  }
  try {
    body = await request.json()
  } catch {
    return json(request, env, { error: 'Invalid JSON' }, 400)
  }

  const { type, conversationId, memberIds, senderId, payload } = body
  if ((type !== 'new_message' && type !== 'update_message') || !conversationId || !payload || !Array.isArray(memberIds)) {
    return json(request, env, { error: 'Invalid emit payload' }, 400)
  }

  const recipients = [...new Set(memberIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(
    0,
    MAX_EMIT_RECIPIENTS
  )
  const event: DeliverEvent = { type, conversationId, senderId, payload }

  const results = await Promise.allSettled(
    recipients.map((memberId) =>
      env.MESSAGING_HUB.get(env.MESSAGING_HUB.idFromName(memberId)).deliver(event, memberId === senderId)
    )
  )
  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed) console.warn(`emit: ${failed}/${recipients.length} deliveries failed`)
  return json(request, env, { ok: true, recipients: recipients.length, failed })
}

/**
 * Row-change events from Postgres (a trigger posts them via pg_net). Writer-agnostic:
 * whichever route or job changed the row, connected clients hear about it.
 *   notifications  -> that user's sockets get {type:'notification_change'}
 *   board_comments -> everyone in that board's room gets a custom message
 */
async function handleEvent(request: Request, env: Env): Promise<Response> {
  if (!checkInternalAuth(request, env.INTERNAL_API_SECRET)) return json(request, env, { error: 'Unauthorized' }, 401)

  let evt: { table?: string; op?: string; record?: Record<string, unknown> | null; old?: Record<string, unknown> | null }
  try {
    evt = await request.json()
  } catch {
    return json(request, env, { error: 'Invalid JSON' }, 400)
  }
  const row = evt.record ?? evt.old ?? {}

  if (evt.table === 'notifications') {
    const userId = row.user_id
    if (typeof userId !== 'string') return json(request, env, { error: 'Missing user_id' }, 400)
    await env.MESSAGING_HUB.get(env.MESSAGING_HUB.idFromName(userId)).notificationChanged()
    return json(request, env, { ok: true })
  }

  if (evt.table === 'board_comments') {
    const boardId = row.board_id
    if (typeof boardId !== 'string') return json(request, env, { error: 'Missing board_id' }, 400)
    let message: object
    if (evt.op === 'INSERT') message = { type: 'comment_insert', row: evt.record }
    else if (evt.op === 'DELETE') message = { type: 'comment_delete', id: row.id }
    else return json(request, env, { ok: true, ignored: true })
    const stub = await getServerByName(env.BOARD_ROOM, boardId)
    await stub.fetch(new Request('https://room.internal/broadcast', { method: 'POST', body: JSON.stringify(message) }))
    return json(request, env, { ok: true })
  }

  return json(request, env, { error: 'Unsupported table' }, 400)
}

async function handleHealth(request: Request, env: Env): Promise<Response> {
  const boardId = new URL(request.url).searchParams.get('boardId')

  const dbCheck = fetch(`${env.SUPABASE_URL}/rest/v1/`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY },
    signal: AbortSignal.timeout(2500),
  })
    .then((r) => (r.ok ? 'connected' : 'error'))
    .catch(() => 'error')

  let roomConnections = 0
  if (boardId) {
    // Only counts connections; no identity is exposed on this unauthenticated endpoint.
    const stub = await getServerByName(env.BOARD_ROOM, boardId)
    const res = await stub.fetch(new Request('https://room.internal/connections'))
    if (res.ok) roomConnections = ((await res.json()) as { totalConnections: number }).totalConnections
  }

  return json(request, env, {
    status: 'ok',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    supabaseStatus: await dbCheck,
    // Durable Objects replace the Redis pub/sub layer; reported as connected for the UI.
    redisStatus: 'connected',
    roomConnections,
  })
}

async function handleRoomInfo(request: Request, env: Env, boardId: string, kind: 'connections' | 'awareness'): Promise<Response> {
  const claims = await verifyTicket(bearer(request), env.NEXTAUTH_SECRET)
  if (!claims) return json(request, env, { error: 'Unauthorized' }, 401)
  if (!(await getBoardPermission(env, boardId, claims.userId))) return json(request, env, { error: 'Forbidden' }, 403)

  const stub = await getServerByName(env.BOARD_ROOM, boardId)
  const res = await stub.fetch(new Request(`https://room.internal/${kind}`))
  return json(request, env, await res.json(), res.status)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!startedAt) startedAt = Date.now()
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const isUpgrade = request.headers.get('Upgrade')?.toLowerCase() === 'websocket'

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) })
    }

    try {
      if (path === '/health') return await handleHealth(request, env)

      if (path === '/messaging/emit' && request.method === 'POST') return await handleEmit(request, env)
      if (path === '/events' && request.method === 'POST') return await handleEvent(request, env)
      if (path === '/messaging') {
        return isUpgrade ? await handleMessagingSocket(request, env) : new Response('Expected WebSocket', { status: 426 })
      }

      const ws = path.match(/^\/ws\/([^/]+)$/)
      if (ws) {
        const boardId = decodeURIComponent(ws[1])
        return isUpgrade ? await handleBoardSocket(request, env, boardId) : new Response('Expected WebSocket', { status: 426 })
      }

      const room = path.match(/^\/api\/rooms\/([^/]+)\/(connections|awareness)$/)
      if (room && request.method === 'GET') {
        return await handleRoomInfo(request, env, decodeURIComponent(room[1]), room[2] as 'connections' | 'awareness')
      }

      return json(request, env, { error: 'Not found' }, 404)
    } catch (err) {
      console.error('unhandled error:', err)
      return json(request, env, { error: 'Internal error' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
