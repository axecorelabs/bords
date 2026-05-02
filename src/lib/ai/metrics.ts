import { redis } from '@/lib/redis'

function dayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

async function incrCounter(metric: string, value = 1): Promise<void> {
  if (!redis) return
  const key = `ai:metrics:${dayKey()}:${metric}`
  try {
    await redis.incrby(key, value)
    await redis.expire(key, 60 * 60 * 24 * 14)
  } catch {
    // Best effort only.
  }
}

export async function recordAiEvent(event: 'response_cache_hit' | 'response_cache_miss' | 'prompt_cache_hit' | 'prompt_cache_miss' | 'retrieval_cache_hit' | 'retrieval_cache_miss'): Promise<void> {
  await incrCounter(event, 1)
}

export async function recordAiLatency(ms: number): Promise<void> {
  await incrCounter('latency_total_ms', Math.max(0, Math.floor(ms)))
  await incrCounter('latency_count', 1)
}

export async function recordPromptSize(chars: number): Promise<void> {
  await incrCounter('prompt_chars_total', Math.max(0, chars))
  await incrCounter('prompt_chars_count', 1)
}
