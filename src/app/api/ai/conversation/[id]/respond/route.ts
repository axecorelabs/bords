import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'
import { generateAiText, streamAiText } from '@/lib/ai/gateway'
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

type StageTimings = Record<string, number>

async function measureStage<T>(
  timings: StageTimings,
  key: string,
  work: () => PromiseLike<T> | T,
): Promise<T> {
  const startedAt = Date.now()
  try {
    return await work()
  } finally {
    timings[key] = Date.now() - startedAt
  }
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

function shouldRunRetrieval(message: string, taggedBoardIds: string[]): boolean {
  if (taggedBoardIds.length > 0) return true

  const text = message.trim().toLowerCase()
  if (!text) return false

  // Skip expensive workspace retrieval for pure social/meta chat.
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|cool|great|nice|lol|yo)[!. ]*$/i.test(text)) {
    return false
  }

  // Run retrieval when the user is clearly asking about workspace state.
  if (/(board|task|checklist|kanban|sticky|workstream|assignment|assignee|deadline|due|status|progress|blocker|owner|org|organization|workspace|project|roadmap|milestone|sprint|#([a-z0-9_-]+))/i.test(text)) {
    return true
  }

  // Default to skipping retrieval for generic conversation to avoid ~2s overhead.
  return false
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

/**
 * Fetch the latest approved/applied/draft plan artifact for a conversation and
 * format it as a concise context block so follow-up questions always have
 * access to plan details regardless of history window.
 */
async function getConversationPlanContext(conversationId: string, userId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .select('title, goal, content')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .in('status', ['draft', 'approved', 'applied'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return ''

  const row = data as any
  const title: string = row.title ?? 'Plan'
  const goal: string = row.goal ? row.goal.split('\n')[0].trim() : ''
  const content = row.content as Record<string, unknown> | null

  const lines: string[] = [`## Active Plan: ${title}`]
  if (goal) lines.push(`Goal: ${goal}`)

  const outcomes = Array.isArray(content?.outcomes) ? (content!.outcomes as string[]) : []
  if (outcomes.length > 0) {
    lines.push('Success metrics: ' + outcomes.slice(0, 4).join('; '))
  }

  const workstreams = Array.isArray(content?.workstreams)
    ? (content!.workstreams as Array<{ title?: string; checklist?: string[] }>)
    : []
  if (workstreams.length > 0) {
    lines.push('Plan structure:')
    for (const ws of workstreams) {
      const wsTitle = (ws.title ?? '').trim()
      if (!wsTitle) continue
      lines.push(`  - ${wsTitle}`)
      const tasks = Array.isArray(ws.checklist) ? ws.checklist : []
      for (const t of tasks.slice(0, 6)) {
        lines.push(`    • ${String(t).trim()}`)
      }
    }
  }

  return lines.join('\n')
}

function isTruncationFinishReason(reason: string | undefined): boolean {
  const normalized = (reason || '').toLowerCase()
  return normalized === 'length' || normalized === 'max_tokens'
}

function buildContinuationMessages(base: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, partialAnswer: string) {
  return [
    ...base,
    { role: 'assistant' as const, content: partialAnswer },
    {
      role: 'user' as const,
      content: 'Continue exactly where you stopped. Do not repeat prior sections. Start with the next unfinished point.',
    },
  ]
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
  const stageTimings: StageTimings = {}
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const rateLimitResponse = await measureStage(stageTimings, 'rate_limit', () =>
    checkRateLimit(apiLimiter, getRateLimitKey(req, user.id))
  )
  if (rateLimitResponse) return rateLimitResponse

  const { id: conversationId } = await params
  if (!conversationId) return badRequest('conversationId required')

  // Verify this is an AI conversation and the user is a member
  const [{ data: conv }, { data: membership }] = await Promise.all([
    measureStage(stageTimings, 'load_conversation', () =>
      supabaseAdmin
        .from('conversations')
        .select('id, is_ai_conversation, organization_id')
        .eq('id', conversationId)
        .single()
    ),
    measureStage(stageTimings, 'verify_membership', () =>
      supabaseAdmin
        .from('conversation_members')
        .select('user_id')
        .eq('conversation_id', conversationId)
        .eq('user_id', user.id)
        .maybeSingle()
    ),
  ])

  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  if (!conv.is_ai_conversation) return NextResponse.json({ error: 'Not an AI conversation' }, { status: 400 })

  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const userMessage: string = body.userMessage?.trim() ?? ''
  const wantsStream = body.stream === true
  if (!userMessage) return badRequest('userMessage required')
  if (userMessage.length > 8000) return badRequest('userMessage too long')

  // Never trust client orgId for retrieval scope. Scope is derived from the conversation.
  const orgId: string | null = conv.organization_id ?? null
  /** Board UUIDs explicitly selected by the user via the board chip picker. */
  const taggedBoardIds: string[] = Array.isArray(body.taggedBoardIds) ? body.taggedBoardIds : []
  const handles = extractHandles(userMessage)

  const capability = await measureStage(stageTimings, 'capability', () =>
    tryExecuteAiCapability({
      userId: user.id,
      conversationId,
      orgId,
      message: userMessage,
      taggedBoardIds,
    })
  )

  if (capability.handled && capability.text) {
    const capabilityMeta = {
      model: 'bords-capability',
      provider: 'bords',
      task: 'chat',
      latencyMs: Date.now() - startedAt,
      stageTimings,
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

  const [{ systemPrompt: cachedSystemPrompt }, { recent }] = await Promise.all([
    (async () => {
      const systemPrompt = await measureStage(stageTimings, 'prompt_cache_get', () =>
        getJsonCache<string>(promptCacheKey)
      )
      return { systemPrompt }
    })(),
    (async () => {
      const { data: recent } = await measureStage(stageTimings, 'load_history', () =>
        supabaseAdmin
          .from('messages')
          .select('id, content, sender_id, is_ai_message, created_at')
          .eq('conversation_id', conversationId)
          .eq('is_deleted', false)
          .order('created_at', { ascending: false })
          .limit(AI_ROUTE_BUDGET.maxFetchedHistory)
      )
      return { recent }
    })(),
  ])

  let systemPrompt = cachedSystemPrompt
  if (!systemPrompt) {
    await recordAiEvent('prompt_cache_miss')
    systemPrompt = await measureStage(stageTimings, 'prompt_build', () =>
      buildAiSystemPrompt({
        userId: user.id,
        orgId,
        taggedBoardIds,
        userMessage,
      })
    )
    void setJsonCache(promptCacheKey, systemPrompt!, AI_ROUTE_BUDGET.promptCacheTtlSec).catch(() => {})
  } else {
    await recordAiEvent('prompt_cache_hit')
  }

  let retrieved: Awaited<ReturnType<typeof retrieveHybridContext>> = []
  if (shouldRunRetrieval(userMessage, taggedBoardIds)) {
    const role = await measureStage(stageTimings, 'resolve_role', () => resolveOrgRole(user.id, orgId))
    const allowedBoardIds = await measureStage(stageTimings, 'resolve_allowed_boards', () =>
      resolveAllowedBoardIds(user.id, orgId, role)
    )
    const retrievalBoardIds = scopeRetrievalBoardIds(allowedBoardIds, taggedBoardIds)
    retrieved = await measureStage(stageTimings, 'retrieval', () =>
      retrieveHybridContext({
        userId: user.id,
        orgId,
        role,
        allowedBoardIds: retrievalBoardIds,
        query: userMessage,
        limit: 8,
      })
    )
  }
  const retrievalContext = formatRetrievedChunks(retrieved)

  if (retrievalContext) {
    systemPrompt = `${systemPrompt}\n\n${retrievalContext}`
  }

  // Inject the active plan artifact so follow-up questions always have full plan content,
  // even when the plan draft message has been summarized out of the raw history window.
  const planContext = await getConversationPlanContext(conversationId, user.id)
  if (planContext) {
    systemPrompt = `${systemPrompt}\n\n${planContext}`
  }

  await recordPromptSize(systemPrompt.length)

  // ── Fetch recent conversation history for context ─────────────────────────
  const history = (recent ?? []).reverse().map((m: any) => ({
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
  const rawRecentHistory = history.slice(-AI_ROUTE_BUDGET.maxRawHistory).map((m: any) => ({
    role: m.role,
    content: m.content,
  }))

  let summaryBlock = ''
  if (olderHistory.length > 0) {
    const digest = shortHash(olderHistory.map((m: any) => `${m.id}:${m.role}:${m.content}`).join('|'))
    const summaryKey = buildConversationSummaryKey(conversationId, digest)
    summaryBlock = (await measureStage(stageTimings, 'summary_cache_get', () => getJsonCache<string>(summaryKey))) ?? ''
    if (!summaryBlock) {
      summaryBlock = compactSummary(olderHistory.map((m: any) => ({ role: m.role, content: m.content })))
      void setJsonCache(summaryKey, summaryBlock, AI_ROUTE_BUDGET.summaryCacheTtlSec).catch(() => {})
    }
  }

  const chatPolicy = getTaskPolicy('chat')
  const model = chatPolicy.model
  const chatMaxTokens = Math.min(
    parsePositiveInt(process.env.AI_CHAT_MAX_TOKENS, 1200),
    chatPolicy.maxTokens
  )
  const chatAutoContinuePasses = Math.min(parsePositiveInt(process.env.AI_CHAT_AUTO_CONTINUE_PASSES, 1), 2)
  const promptHash = shortHash(`${systemPrompt}\n${summaryBlock}`)
  const responseCacheKey = buildAiResponseCacheKey({
    conversationId,
    userId: user.id,
    orgId,
    model,
    promptHash,
    query: userMessage,
  })

  const cachedAiText = await measureStage(stageTimings, 'response_cache_get', () =>
    getJsonCache<string>(responseCacheKey)
  )

  const persistAiReply = async (finalText: string, finalMeta: {
    model: string
    provider: string
    task: string
    latencyMs: number
    cached?: boolean
    finishReason?: string
    continuationPasses?: number
  }) => {
    await recordAiLatency(Date.now() - startedAt)

    let savedMsg: {
      id: string
      content: string
      sender_id: string
      created_at: string
      is_ai_message: boolean
      metadata?: unknown
    } | null = null
    let insertErr: { message?: string } | null = null
    const aiMeta = { ...finalMeta, stageTimings }

    const primaryInsert = await measureStage(stageTimings, 'persist_reply', () =>
      supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: BORDS_AI_PROFILE_ID,
          content: finalText,
          is_ai_message: true,
          metadata: aiMeta,
        } as never)
        .select('id, content, sender_id, created_at, is_ai_message, metadata')
        .single()
    )

    savedMsg = primaryInsert.data as any
    insertErr = primaryInsert.error as any

    if (insertErr?.message?.includes("Could not find the 'metadata' column")) {
      const fallbackInsert = await measureStage(stageTimings, 'persist_reply_fallback', () =>
        supabaseAdmin
          .from('messages')
          .insert({
            conversation_id: conversationId,
            sender_id: BORDS_AI_PROFILE_ID,
            content: finalText,
            is_ai_message: true,
          } as never)
          .select('id, content, sender_id, created_at, is_ai_message')
          .single()
      )

      savedMsg = fallbackInsert.data as any
      insertErr = fallbackInsert.error as any
    }

    if (insertErr || !savedMsg) {
      throw new Error(insertErr?.message ?? 'Failed to save AI message')
    }

    await measureStage(stageTimings, 'touch_conversation', () =>
      supabaseAdmin
        .from('conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId)
    )

    console.info('[AI respond latency]', {
      conversationId,
      userId: user.id,
      provider: finalMeta.provider,
      model: finalMeta.model,
      totalMs: Date.now() - startedAt,
      stageTimings,
      promptChars: systemPrompt.length,
      retrievedChunks: retrieved.length,
      taggedBoardCount: taggedBoardIds.length,
    })

    return {
      savedMsg,
      aiMeta,
    }
  }

  if (wantsStream) {
    const encoder = new TextEncoder()

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const writeEvent = (event: string, payload: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`))
        }

        void (async () => {
          let aiText = ''
          let meta: {
            model: string
            provider: string
            task: string
            latencyMs: number
            cached?: boolean
            finishReason?: string
            continuationPasses?: number
          }

          try {
            if (cachedAiText) {
              await recordAiEvent('response_cache_hit')
              aiText = cachedAiText
              meta = {
                model,
                provider: process.env.AI_PROVIDER === 'mock' ? 'mock' : 'openrouter',
                task: 'chat',
                latencyMs: 0,
                cached: true,
                finishReason: 'cache',
                continuationPasses: 0,
              }
              if (aiText) writeEvent('chunk', { delta: aiText })
            } else {
              await recordAiEvent('response_cache_miss')
              const baseMessages = [
                ...(summaryBlock
                  ? [{ role: 'system' as const, content: `Conversation summary:\n${summaryBlock}` }]
                  : []),
                ...rawRecentHistory,
              ]

              let totalLatencyMs = 0
              let continuationPasses = 0

              let result = await streamAiText({
                task: 'chat',
                messages: baseMessages,
                systemPrompt,
                maxTokens: chatMaxTokens,
                temperature: 0.4,
              }, {
                onChunk: async ({ textDelta }) => {
                  aiText += textDelta
                  writeEvent('chunk', { delta: textDelta })
                },
              })
              totalLatencyMs += result.meta.latencyMs

              while (isTruncationFinishReason(result.meta.finishReason) && continuationPasses < chatAutoContinuePasses) {
                continuationPasses += 1
                result = await streamAiText({
                  task: 'chat',
                  messages: buildContinuationMessages(baseMessages, aiText),
                  systemPrompt,
                  maxTokens: chatMaxTokens,
                  temperature: 0.3,
                }, {
                  onChunk: async ({ textDelta }) => {
                    aiText += textDelta
                    writeEvent('chunk', { delta: textDelta })
                  },
                })
                totalLatencyMs += result.meta.latencyMs
              }

              meta = {
                model: result.meta.model,
                provider: result.meta.provider,
                task: result.meta.task,
                latencyMs: totalLatencyMs,
                finishReason: result.meta.finishReason,
                continuationPasses,
              }
              stageTimings.model = totalLatencyMs
              void setJsonCache(responseCacheKey, aiText, AI_ROUTE_BUDGET.responseCacheTtlSec).catch(() => {})
            }

            const { savedMsg, aiMeta } = await persistAiReply(aiText, meta)
            writeEvent('done', {
              id: savedMsg.id,
              content: savedMsg.content,
              senderId: savedMsg.sender_id,
              createdAt: savedMsg.created_at,
              isAiMessage: true,
              aiMeta,
            })
          } catch (err) {
            console.error('[AI respond stream] error:', err)
            writeEvent('error', { error: 'Bords AI is unavailable right now' })
          } finally {
            controller.close()
          }
        })()
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  }

  // ── Call AI gateway ────────────────────────────────────────────────────────
  let aiText: string
  let meta: {
    model: string
    provider: string
    task: string
    latencyMs: number
    cached?: boolean
    finishReason?: string
    continuationPasses?: number
  }

  if (cachedAiText) {
    await recordAiEvent('response_cache_hit')
    aiText = cachedAiText
    meta = {
      model,
      provider: process.env.AI_PROVIDER === 'mock' ? 'mock' : 'openrouter',
      task: 'chat',
      latencyMs: 0,
      cached: true,
      finishReason: 'cache',
      continuationPasses: 0,
    }
  } else {
    await recordAiEvent('response_cache_miss')
    try {
      const baseMessages = [
        ...(summaryBlock
          ? [{ role: 'system' as const, content: `Conversation summary:\n${summaryBlock}` }]
          : []),
        ...rawRecentHistory,
      ]

      let totalLatencyMs = 0
      let continuationPasses = 0

      let result = await generateAiText({
        task: 'chat',
        messages: baseMessages,
        systemPrompt,
        maxTokens: chatMaxTokens,
        temperature: 0.4,
      })
      totalLatencyMs += result.meta.latencyMs
      aiText = result.text

      while (isTruncationFinishReason(result.meta.finishReason) && continuationPasses < chatAutoContinuePasses) {
        continuationPasses += 1
        result = await generateAiText({
          task: 'chat',
          messages: buildContinuationMessages(baseMessages, aiText),
          systemPrompt,
          maxTokens: chatMaxTokens,
          temperature: 0.3,
        })
        totalLatencyMs += result.meta.latencyMs
        if (result.text) {
          aiText = `${aiText}\n${result.text}`.trim()
        }
      }

      meta = {
        model: result.meta.model,
        provider: result.meta.provider,
        task: result.meta.task,
        latencyMs: totalLatencyMs,
        finishReason: result.meta.finishReason,
        continuationPasses,
      }
      stageTimings.model = totalLatencyMs
      void setJsonCache(responseCacheKey, aiText, AI_ROUTE_BUDGET.responseCacheTtlSec).catch(() => {})
    } catch (err) {
      console.error('[AI respond] gateway error:', err)
      return NextResponse.json({ error: 'AI provider unavailable' }, { status: 502 })
    }
  }

  const { savedMsg, aiMeta } = await persistAiReply(aiText, meta)

  return NextResponse.json({
    id: savedMsg.id,
    content: savedMsg.content,
    senderId: savedMsg.sender_id,
    createdAt: savedMsg.created_at,
    isAiMessage: true,
    aiMeta,
  })
}
