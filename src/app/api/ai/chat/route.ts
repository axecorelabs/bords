import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthUser, badRequest, unauthorized } from '@/lib/api-helpers'
import { aiChatRequestSchema } from '@/lib/ai/types'
import { generateAiText } from '@/lib/ai/gateway'
import { apiLimiter, checkRateLimit, getRateLimitKey } from '@/lib/rate-limit'

const requestSchema = aiChatRequestSchema.extend({
  context: z.object({
    boardId: z.string().trim().uuid().optional(),
    organizationId: z.string().trim().uuid().optional(),
  }).optional(),
})

export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const rateLimitResponse = await checkRateLimit(apiLimiter, getRateLimitKey(req, user.id))
  if (rateLimitResponse) return rateLimitResponse

  const json = await req.json().catch(() => null)
  const parsed = requestSchema.safeParse(json)
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message || 'Invalid AI request')
  }

  try {
    const result = await generateAiText({
      task: parsed.data.task,
      messages: parsed.data.messages,
      maxTokens: parsed.data.maxTokens,
      temperature: parsed.data.temperature,
    })

    return NextResponse.json({
      ok: true,
      text: result.text,
      usage: result.usage,
      meta: result.meta,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown AI provider error'
    console.error('[ai/chat] provider failure:', message)
    return NextResponse.json({ error: 'AI provider unavailable' }, { status: 502 })
  }
}
