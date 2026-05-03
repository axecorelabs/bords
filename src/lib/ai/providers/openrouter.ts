import { getOpenRouterBaseUrl, getTaskPolicy } from '@/lib/ai/model-policy'
import type { AiGenerateInput, AiGenerateResult, AiProvider, AiStreamCallbacks } from '@/lib/ai/types'

type OpenRouterChoice = {
  finish_reason?: string
  delta?: {
    content?: string
  }
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

type OpenRouterStreamLine = {
  choices?: OpenRouterChoice[]
  usage?: OpenRouterUsage
  model?: string
}

export class OpenRouterProvider implements AiProvider {
  name: 'openrouter' = 'openrouter'

  private buildRequestBody(input: AiGenerateInput, stream = false): Record<string, unknown> {
    const policy = getTaskPolicy(input.task)
    return {
      model: policy.model,
      messages: [
        ...(input.systemPrompt
          ? [{ role: 'system', content: input.systemPrompt }]
          : []),
        ...input.messages,
      ],
      max_tokens: Math.min(input.maxTokens, policy.maxTokens),
      temperature: input.temperature,
      ...(stream ? { stream: true } : {}),
    }
  }

  private async createResponse(input: AiGenerateInput, stream = false): Promise<Response> {
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
      body: JSON.stringify(this.buildRequestBody(input, stream)),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`OpenRouter request failed (${res.status}): ${body.slice(0, 400)}`)
    }

    return res
  }

  async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    const started = Date.now()
    const policy = getTaskPolicy(input.task)
    const res = await this.createResponse(input)

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

  async stream(input: AiGenerateInput, callbacks: AiStreamCallbacks): Promise<AiGenerateResult> {
    const started = Date.now()
    const policy = getTaskPolicy(input.task)
    const res = await this.createResponse(input, true)
    const reader = res.body?.getReader()

    if (!reader) {
      throw new Error('OpenRouter stream body is unavailable')
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let fullText = ''
    let model = policy.model
    let usage: OpenRouterUsage | undefined
    let finishReason = 'stop'

    const handleLine = async (line: string) => {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) return
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') return

      const parsed = JSON.parse(payload) as OpenRouterStreamLine
      model = parsed.model || model
      usage = parsed.usage || usage
      const choice = parsed.choices?.[0]
      if (!choice) return
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta?.content || ''
      if (!delta) return
      fullText += delta
      await callbacks.onChunk({ textDelta: delta })
    }

    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done })

      let splitIndex = buffer.indexOf('\n')
      while (splitIndex !== -1) {
        const line = buffer.slice(0, splitIndex)
        buffer = buffer.slice(splitIndex + 1)
        await handleLine(line)
        splitIndex = buffer.indexOf('\n')
      }

      if (done) break
    }

    if (buffer.trim()) {
      await handleLine(buffer)
    }

    return {
      text: fullText.trim(),
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        totalTokens: usage?.total_tokens ?? 0,
      },
      meta: {
        provider: this.name,
        model,
        task: input.task,
        latencyMs: Date.now() - started,
        finishReason,
      },
    }
  }
}
