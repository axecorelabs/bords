import { createHash } from 'crypto'
import { redis } from '@/lib/redis'

export const AI_PROMPT_POLICY_VERSION = '2026-05-01.v1'

const CACHE_PREFIX = 'ai'

function hash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32)
}

export function normalizeForCache(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function buildAiResponseCacheKey(params: {
  conversationId: string
  userId: string
  orgId?: string | null
  model: string
  promptHash: string
  query: string
}): string {
  const normalized = normalizeForCache(params.query)
  const digest = hash(normalized)
  return [
    CACHE_PREFIX,
    'resp',
    AI_PROMPT_POLICY_VERSION,
    params.conversationId,
    params.userId,
    params.orgId ?? 'personal',
    params.model,
    params.promptHash,
    digest,
  ].join(':')
}

export function buildPromptCacheKey(params: {
  userId: string
  orgId?: string | null
  taggedBoardIds: string[]
  handles: string[]
}): string {
  const boardPart = [...new Set(params.taggedBoardIds)].sort().join(',')
  const handlePart = [...new Set(params.handles)].sort().join(',')
  const digest = hash(`${boardPart}|${handlePart}`)
  return [
    CACHE_PREFIX,
    'prompt',
    AI_PROMPT_POLICY_VERSION,
    params.userId,
    params.orgId ?? 'personal',
    digest,
  ].join(':')
}

export function buildConversationSummaryKey(conversationId: string, historyDigest: string): string {
  return [CACHE_PREFIX, 'summary', conversationId, historyDigest].join(':')
}

export function buildRetrievalCacheKey(params: {
  userId: string
  orgId?: string | null
  role: 'owner' | 'admin' | 'member' | 'none'
  boardIds: string[]
  queryEmbeddingHash: string
}): string {
  const boardPart = [...new Set(params.boardIds)].sort().join(',')
  const boardDigest = hash(boardPart)
  return [
    CACHE_PREFIX,
    'retrieval',
    AI_PROMPT_POLICY_VERSION,
    params.userId,
    params.orgId ?? 'personal',
    params.role,
    boardDigest,
    params.queryEmbeddingHash,
  ].join(':')
}

export async function getJsonCache<T>(key: string): Promise<T | null> {
  if (!redis) return null
  try {
    const value = await redis.get<T>(key)
    return value ?? null
  } catch {
    return null
  }
}

export async function setJsonCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (!redis) return
  try {
    await redis.set(key, value, { ex: ttlSeconds })
  } catch {
    // Best-effort cache only.
  }
}

export function shortHash(input: string): string {
  return hash(input)
}
