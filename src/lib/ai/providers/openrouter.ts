import { getOpenRouterBaseUrl, getTaskPolicy } from '@/lib/ai/model-policy'
import type { AiGenerateInput, AiGenerateResult, AiProvider } from '@/lib/ai/types'

type OpenRouterChoice = {
  finish_reason?: string
  message?: {
    content?: string
  }
}

type OpenRouterUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}

type OpenRouterResponse = {
  choices?: OpenRouterChoice[]
  usage?: OpenRouterUsage
  model?: string
}

export class OpenRouterProvider implements AiProvider {
  name: 'openrouter' = 'openrouter'

  async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    const started = Date.now()
    const policy = getTaskPolicy(input.task)
    const apiKey = process.env.OPENROUTER_API_KEY

    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY is not set')
    }

    const res = await fetch(`${getOpenRouterBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: policy.model,
        messages: [
          ...(input.systemPrompt
            ? [{ role: 'system', content: input.systemPrompt }]
            : []),
          ...input.messages,
        ],
        max_tokens: Math.min(input.maxTokens, policy.maxTokens),
        temperature: input.temperature,
      }),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenRouter request failed (${res.status}): ${body.slice(0, 400)}`)
    }

    const payload = (await res.json()) as OpenRouterResponse
    const choice = payload.choices?.[0]
    const text = choice?.message?.content?.trim() || ''

    return {
      text,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
        totalTokens: payload.usage?.total_tokens ?? 0,
      },
      meta: {
        provider: this.name,
        model: payload.model || policy.model,
        task: input.task,
        latencyMs: Date.now() - started,
        finishReason: choice?.finish_reason || 'stop',
      },
    }
  }
}
