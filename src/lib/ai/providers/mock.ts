import { getTaskPolicy } from '@/lib/ai/model-policy'
import type { AiGenerateInput, AiGenerateResult, AiProvider, AiStreamCallbacks } from '@/lib/ai/types'

export class MockAiProvider implements AiProvider {
  name: 'mock' = 'mock'

  async generate(input: AiGenerateInput): Promise<AiGenerateResult> {
    const started = Date.now()
    const policy = getTaskPolicy(input.task)
    const latestUserMessage = [...input.messages].reverse().find((m) => m.role === 'user')
    const hasContext = !!input.systemPrompt

    return {
      text: `Mock response for task "${input.task}"${hasContext ? ' [with context]' : ''}. Received: ${latestUserMessage?.content || ''}`,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
      meta: {
        provider: this.name,
        model: policy.model,
        task: input.task,
        latencyMs: Date.now() - started,
        finishReason: 'stop',
      },
    }
  }

  async stream(input: AiGenerateInput, callbacks: AiStreamCallbacks): Promise<AiGenerateResult> {
    const result = await this.generate(input)
    if (result.text) await callbacks.onChunk({ textDelta: result.text })
    return result
  }
}
