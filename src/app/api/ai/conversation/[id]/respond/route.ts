import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'
import { generateAiText } from '@/lib/ai/gateway'
import { buildAiSystemPrompt } from '@/lib/ai/context-builder'
import { getTaskPolicy } from '@/lib/ai/model-policy'
import {
  buildAiResponseCacheKey,
  buildConversationSummaryKey,
  buildPromptCacheKey,
  getJsonCache,
  setJsonCache,
  shortHash,
} from '@/lib/ai/cache'
import { apiLimiter, checkRateLimit, getRateLimitKey } from '@/lib/rate-limit'
import { tryExecuteAiCapability } from '@/lib/ai/capabilities'
import {
  formatRetrievedChunks,
  resolveAllowedBoardIds,
  resolveOrgRole,
  retrieveHybridContext,
  scopeRetrievalBoardIds,
} from '@/lib/ai/retrieval'
import { recordAiEvent, recordAiLatency, recordPromptSize } from '@/lib/ai/metrics'
import { BORDS_AI_PROFILE_ID } from '@/app/api/ai/conversation/ensure/route'

const AI_ROUTE_BUDGET = {
  maxRawHistory: 12,
  maxFetchedHistory: 40,
  maxSummaryChars: 1400,
  responseCacheTtlSec: 120,
  promptCacheTtlSec: 60,
  summaryCacheTtlSec: 180,
}

function extractHandles(text: string): string[] {
  const matches = text.match(/#([a-zA-Z0-9_-]+)/g) ?? []
  return matches.map((m) => m.slice(1).toLowerCase())
}

function compactSummary(entries: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  if (entries.length === 0) return ''
  const lines = entries.map((m) => {
    const who = m.role === 'assistant' ? 'AI' : 'User'
    return `- ${who}: ${m.content.replace(/\s+/g, ' ').slice(0, 180)}`
  })
  const summary = lines.join('\n')
  return summary.length > AI_ROUTE_BUDGET.maxSummaryChars
    ? `${summary.slice(0, AI_ROUTE_BUDGET.maxSummaryChars)}...`
    : summary
}

/**
 * POST /api/ai/conversation/[id]/respond
 * Generates an AI reply for an AI conversation and persists it as a message.
 *
 * Body: { userMessage: string, context?: { boardId?: string; orgId?: string } }
 *
 * Returns the saved AI message.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startedAt = Date.now()
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const rateLimitResponse = await checkRateLimit(apiLimiter, getRateLimitKey(req, user.id))
  if (rateLimitResponse) return rateLimitResponse

  const { id: conversationId } = await params
  if (!conversationId) return badRequest('conversationId required')

  // Verify this is an AI conversation and the user is a member
  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id, is_ai_conversation, organization_id')
    .eq('id', conversationId)
    .single()

  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  if (!conv.is_ai_conversation) return NextResponse.json({ error: 'Not an AI conversation' }, { status: 400 })

  const { data: membership } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const userMessage: string = body.userMessage?.trim() ?? ''
  if (!userMessage) return badRequest('userMessage required')
  if (userMessage.length > 8000) return badRequest('userMessage too long')

  // Never trust client orgId for retrieval scope. Scope is derived from the conversation.
  const orgId: string | null = conv.organization_id ?? null
  /** Board UUIDs explicitly selected by the user via the board chip picker. */
  const taggedBoardIds: string[] = Array.isArray(body.taggedBoardIds) ? body.taggedBoardIds : []
  const handles = extractHandles(userMessage)

  const capability = await tryExecuteAiCapability({
    userId: user.id,
    conversationId,
    orgId,
    message: userMessage,
    taggedBoardIds,
  })

  if (capability.handled && capability.text) {
    const capabilityMeta = {
      model: 'bords-capability',
      provider: 'bords',
      task: 'chat',
      latencyMs: Date.now() - startedAt,
      capability: capability.action ?? 'unknown',
      capabilityData: capability.data ?? null,
    }

    let savedCapabilityMsg: { id: string; content: string; sender_id: string; created_at: string } | null = null
    let capErr: { message?: string } | null = null

    const capabilityInsert = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: BORDS_AI_PROFILE_ID,
        content: capability.text,
        is_ai_message: true,
        metadata: capabilityMeta,
      } as never)
      .select('id, content, sender_id, created_at')
      .single()

    savedCapabilityMsg = capabilityInsert.data as any
    capErr = capabilityInsert.error as any

    // Backward-compatible fallback if metadata column has not been migrated yet.
    if (capErr?.message?.includes("Could not find the 'metadata' column")) {
      const fallbackInsert = await supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: BORDS_AI_PROFILE_ID,
          content: capability.text,
          is_ai_message: true,
        } as never)
        .select('id, content, sender_id, created_at')
        .single()

      savedCapabilityMsg = fallbackInsert.data as any
      capErr = fallbackInsert.error as any
    }

    if (capErr || !savedCapabilityMsg) {
      return NextResponse.json({ error: capErr?.message ?? 'Failed to save AI capability response' }, { status: 500 })
    }

    await supabaseAdmin
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversationId)

    return NextResponse.json({
      id: savedCapabilityMsg.id,
      content: savedCapabilityMsg.content,
      senderId: savedCapabilityMsg.sender_id,
      createdAt: savedCapabilityMsg.created_at,
      isAiMessage: true,
      aiMeta: capabilityMeta,
    })
  }

  // ── Build role-aware system prompt (RAG context), with Redis cache ───────
  const promptCacheKey = buildPromptCacheKey({
    userId: user.id,
    orgId,
    taggedBoardIds,
    handles,
  })

  let systemPrompt = await getJsonCache<string>(promptCacheKey)
  if (!systemPrompt) {
    await recordAiEvent('prompt_cache_miss')
    systemPrompt = await buildAiSystemPrompt({
      userId: user.id,
      orgId,
      taggedBoardIds,
      userMessage,
    })
    await setJsonCache(promptCacheKey, systemPrompt, AI_ROUTE_BUDGET.promptCacheTtlSec)
  } else {
    await recordAiEvent('prompt_cache_hit')
  }

  const role = await resolveOrgRole(user.id, orgId)
  const allowedBoardIds = await resolveAllowedBoardIds(user.id, orgId, role)
  const retrievalBoardIds = scopeRetrievalBoardIds(allowedBoardIds, taggedBoardIds)
  const retrieved = await retrieveHybridContext({
    userId: user.id,
    orgId,
    role,
    allowedBoardIds: retrievalBoardIds,
    query: userMessage,
    limit: 8,
  })
  const retrievalContext = formatRetrievedChunks(retrieved)

  if (retrievalContext) {
    systemPrompt = `${systemPrompt}\n\n${retrievalContext}`
  }

  await recordPromptSize(systemPrompt.length)

  // ── Fetch recent conversation history for context ─────────────────────────
  const { data: recent } = await supabaseAdmin
    .from('messages')
    .select('id, content, sender_id, is_ai_message, created_at')
    .eq('conversation_id', conversationId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(AI_ROUTE_BUDGET.maxFetchedHistory)

  const history = (recent ?? []).reverse().map((m) => ({
    id: m.id,
    role: (m.is_ai_message || m.sender_id === BORDS_AI_PROFILE_ID ? 'assistant' : 'user') as 'user' | 'assistant',
    content: m.content as string,
  }))

  // Append the new user message only if it is not already the last persisted turn.
  const last = history[history.length - 1]
  if (!last || last.role !== 'user' || last.content !== userMessage) {
    history.push({ id: 'pending-user', role: 'user', content: userMessage })
  }

  const olderHistory = history.slice(0, Math.max(0, history.length - AI_ROUTE_BUDGET.maxRawHistory))
  const rawRecentHistory = history.slice(-AI_ROUTE_BUDGET.maxRawHistory).map((m) => ({
    role: m.role,
    content: m.content,
  }))

  let summaryBlock = ''
  if (olderHistory.length > 0) {
    const digest = shortHash(olderHistory.map((m) => `${m.id}:${m.role}:${m.content}`).join('|'))
    const summaryKey = buildConversationSummaryKey(conversationId, digest)
    summaryBlock = (await getJsonCache<string>(summaryKey)) ?? ''
    if (!summaryBlock) {
      summaryBlock = compactSummary(olderHistory.map((m) => ({ role: m.role, content: m.content })))
      await setJsonCache(summaryKey, summaryBlock, AI_ROUTE_BUDGET.summaryCacheTtlSec)
    }
  }

  const model = getTaskPolicy('chat').model
  const promptHash = shortHash(`${systemPrompt}\n${summaryBlock}`)
  const responseCacheKey = buildAiResponseCacheKey({
    conversationId,
    userId: user.id,
    orgId,
    model,
    promptHash,
    query: userMessage,
  })

  const cachedAiText = await getJsonCache<string>(responseCacheKey)

  // ── Call AI gateway ────────────────────────────────────────────────────────
  let aiText: string
  let meta: { model: string; provider: string; task: string; latencyMs: number; cached?: boolean }

  if (cachedAiText) {
    await recordAiEvent('response_cache_hit')
    aiText = cachedAiText
    meta = {
      model,
      provider: process.env.AI_PROVIDER === 'mock' ? 'mock' : 'openrouter',
      task: 'chat',
      latencyMs: 0,
      cached: true,
    }
  } else {
    await recordAiEvent('response_cache_miss')
    try {
      const result = await generateAiText({
        task: 'chat',
        messages: [
          ...(summaryBlock
            ? [{ role: 'system' as const, content: `Conversation summary:\n${summaryBlock}` }]
            : []),
          ...rawRecentHistory,
        ],
        systemPrompt,
        maxTokens: 800,
        temperature: 0.4,
      })
      aiText = result.text
      meta = {
        model: result.meta.model,
        provider: result.meta.provider,
        task: result.meta.task,
        latencyMs: result.meta.latencyMs,
      }
      await setJsonCache(responseCacheKey, aiText, AI_ROUTE_BUDGET.responseCacheTtlSec)
    } catch (err) {
      console.error('[AI respond] gateway error:', err)
      return NextResponse.json({ error: 'AI provider unavailable' }, { status: 502 })
    }
  }

  await recordAiLatency(Date.now() - startedAt)

  // ── Persist AI reply ────────────────────────────────────────────────────────
  let savedMsg: {
    id: string
    content: string
    sender_id: string
    created_at: string
    is_ai_message: boolean
    metadata?: unknown
  } | null = null
  let insertErr: { message?: string } | null = null

  const primaryInsert = await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: BORDS_AI_PROFILE_ID,
      content: aiText,
      is_ai_message: true,
      metadata: meta,
    } as never)
    .select('id, content, sender_id, created_at, is_ai_message, metadata')
    .single()

  savedMsg = primaryInsert.data as any
  insertErr = primaryInsert.error as any

  // Backward-compatible fallback if metadata column has not been migrated yet.
  if (insertErr?.message?.includes("Could not find the 'metadata' column")) {
    const fallbackInsert = await supabaseAdmin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_id: BORDS_AI_PROFILE_ID,
        content: aiText,
        is_ai_message: true,
      } as never)
      .select('id, content, sender_id, created_at, is_ai_message')
      .single()

    savedMsg = fallbackInsert.data as any
    insertErr = fallbackInsert.error as any
  }

  if (insertErr || !savedMsg) {
    return NextResponse.json({ error: insertErr?.message ?? 'Failed to save AI message' }, { status: 500 })
  }

  // Update conversation updated_at so it bubbles to top of list
  await supabaseAdmin
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversationId)

  return NextResponse.json({
    id: savedMsg.id,
    content: savedMsg.content,
    senderId: savedMsg.sender_id,
    createdAt: savedMsg.created_at,
    isAiMessage: true,
    aiMeta: meta,
  })
}
