import { getActiveAiProvider } from '@/lib/ai/model-policy'
import { MockAiProvider } from '@/lib/ai/providers/mock'
import { OpenRouterProvider } from '@/lib/ai/providers/openrouter'
import type { AiGenerateInput, AiGenerateResult, AiProvider } from '@/lib/ai/types'

function resolveProvider(): AiProvider {
  const provider = getActiveAiProvider()
  if (provider === 'mock') return new MockAiProvider()
  return new OpenRouterProvider()
}

export async function generateAiText(input: AiGenerateInput): Promise<AiGenerateResult> {
  const provider = resolveProvider()
  return provider.generate(input)
}
