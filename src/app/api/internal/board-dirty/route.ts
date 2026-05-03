import { NextResponse } from 'next/server'
import { redis } from '@/lib/redis'

/**
 * POST /api/internal/board-dirty
 *
 * Called by the collab server after persisting a Y.Doc update so the
 * board-projection cron can prioritise recently-edited shared boards.
 *
 * Body: { boardIds: string[] }
 * Auth: Bearer matching INTERNAL_API_SECRET env var.
 *
 * Uses Redis SADD to maintain a lightweight dirty set with a TTL so
 * entries self-expire even if the worker falls behind.  Falls back
 * gracefully when Redis is unavailable (cron polling still catches it).
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.INTERNAL_API_SECRET

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let boardIds: string[] = []
  try {
    const body = await request.json()
    if (!Array.isArray(body?.boardIds)) {
      return NextResponse.json({ error: 'boardIds must be an array' }, { status: 400 })
    }
    boardIds = body.boardIds
      .filter((id: unknown) => typeof id === 'string' && id.length > 0)
      .slice(0, 100) // cap per request
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (boardIds.length === 0) {
    return NextResponse.json({ ok: true, enqueued: 0 })
  }

  if (redis) {
    try {
      const DIRTY_KEY = 'board_projection:dirty'
      const TTL_SECONDS = 60 * 60 * 2 // 2 hours — stale entries self-expire

      await redis.sadd(DIRTY_KEY, boardIds[0], ...boardIds.slice(1))
      // Refresh TTL on every write so the key lives as long as there's activity
      await redis.expire(DIRTY_KEY, TTL_SECONDS)
    } catch {
      // Redis write failure is non-fatal — cron polling still covers it
    }
  }

  return NextResponse.json({ ok: true, enqueued: boardIds.length })
}
