import { NextResponse } from 'next/server'
import { processEmbeddingJobs } from '@/lib/ai/indexer'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const batch = Number(url.searchParams.get('batch') ?? '20')
  const batchSize = Number.isFinite(batch) ? Math.max(1, Math.min(100, batch)) : 20

  try {
    const result = await processEmbeddingJobs(batchSize)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Embedding worker failed'
    console.error('[cron/ai-embeddings] error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
