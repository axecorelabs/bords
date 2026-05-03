import { NextResponse } from 'next/server'
import { processBoardProjectionJobs } from '@/lib/ai/board-projection'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const batch = Number(url.searchParams.get('batch') ?? '20')
  const lookbackMinutes = Number(url.searchParams.get('lookbackMinutes') ?? '180')

  const batchSize = Number.isFinite(batch) ? Math.max(1, Math.min(200, batch)) : 20
  const lookback = Number.isFinite(lookbackMinutes)
    ? Math.max(1, Math.min(24 * 60, lookbackMinutes))
    : 180

  try {
    const result = await processBoardProjectionJobs(batchSize, lookback)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Board projection worker failed'
    console.error('[cron/board-projections] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
