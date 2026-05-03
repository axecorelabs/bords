import type { AiTask } from '@/lib/ai/types'

type TaskPolicy = {
  model: string
  maxTokens: number
  temperature: number
}

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL?.trim() || 'openrouter/auto'
const CHAT_MODEL = process.env.OPENROUTER_CHAT_MODEL?.trim() || 'google/gemini-2.5-flash'

const taskPolicyMap: Record<AiTask, TaskPolicy> = {
  chat: {
    model: CHAT_MODEL,
    maxTokens: 1800,
    temperature: 0.3,
  },
  summarize: {
    model: DEFAULT_MODEL,
    maxTokens: 500,
    temperature: 0.1,
  },
  taskify: {
    model: DEFAULT_MODEL,
    maxTokens: 1800,
    temperature: 0.2,
  },
  classify: {
    model: DEFAULT_MODEL,
    maxTokens: 1200,
    temperature: 0,
  },
}

export function getTaskPolicy(task: AiTask): TaskPolicy {
  return taskPolicyMap[task]
}

export function getActiveAiProvider(): 'openrouter' | 'mock' {
  const configured = (process.env.AI_PROVIDER || 'openrouter').trim().toLowerCase()
  if (configured === 'mock') return 'mock'
  return 'openrouter'
}

export function getOpenRouterBaseUrl(): string {
  return process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1'
}
