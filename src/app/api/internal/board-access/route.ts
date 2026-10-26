import { NextResponse } from 'next/server'
import { resolveBoardPermission } from '@/lib/board-permission'
import { createAccessCache } from '@/lib/board-access-cache'
import { isInternalRequest } from '@/lib/internal-auth'
import { redis } from '@/lib/redis'

export const dynamic = 'force-dynamic'

const cache = createAccessCache(redis)

/**
 * POST /api/internal/board-access
 *
 * Called by the realtime Worker before it lets a socket into a board room.
 * Body: { boardId: string, userId: string }
 * Auth: Bearer matching INTERNAL_API_SECRET.
 * Response:
 *   200 { permission: 'owner' | 'edit' | 'view' | null }     (+ "stale": true if served from the last-known copy)
 *   503 { error }                                            the database couldn't answer and nothing usable is cached
 *
 * A 503 means "unavailable", which callers must not confuse with a 200 { permission: null } ("denied").
 */
export async function POST(request: Request) {
  if (!isInternalRequest(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { boardId?: unknown; userId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.boardId !== 'string' || !body.boardId || typeof body.userId !== 'string' || !body.userId) {
    return NextResponse.json({ error: 'boardId and userId are required' }, { status: 400 })
  }
  const { boardId, userId } = body
  const noStore = { 'Cache-Control': 'no-store' }

  const hit = await cache.getFresh(boardId, userId)
  if (hit) return NextResponse.json({ permission: hit.p }, { headers: noStore })

  try {
    const permission = await resolveBoardPermission(boardId, userId)
    await cache.put(boardId, userId, permission)
    return NextResponse.json({ permission }, { headers: noStore })
  } catch (err) {
    console.error('[board-access] lookup failed:', err)
    // The database is struggling. Someone who was recently allowed in can keep working; nobody else gets in.
    const last = await cache.getLastKnown(boardId, userId)
    if (last?.p) return NextResponse.json({ permission: last.p, stale: true }, { headers: noStore })
    return NextResponse.json({ error: 'Access check unavailable' }, { status: 503, headers: noStore })
  }
}
