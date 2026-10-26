import { NextResponse } from 'next/server'
import { resolveBoardPermission } from '@/lib/board-permission'
import { isInternalRequest } from '@/lib/internal-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/internal/board-access
 *
 * Called by the realtime Worker before it lets a socket into a board room.
 * Body: { boardId: string, userId: string }
 * Auth: Bearer matching INTERNAL_API_SECRET.
 * Response: { permission: 'owner' | 'edit' | 'view' | null }
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

  const permission = await resolveBoardPermission(body.boardId, body.userId)
  return NextResponse.json({ permission }, { headers: { 'Cache-Control': 'no-store' } })
}
