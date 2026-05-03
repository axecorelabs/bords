import { z } from 'zod'

export const aiTaskSchema = z.enum(['chat', 'summarize', 'taskify', 'classify'])
export type AiTask = z.infer<typeof aiTaskSchema>

export const aiRoleSchema = z.enum(['system', 'user', 'assistant'])
export type AiRole = z.infer<typeof aiRoleSchema>

export const aiMessageSchema = z.object({
  role: aiRoleSchema,
  content: z.string().trim().min(1).max(8000),
})
export type AiMessage = z.infer<typeof aiMessageSchema>

export const aiContextSchema = z.object({
  boardId: z.string().trim().uuid().optional(),
  organizationId: z.string().trim().uuid().optional(),
}).optional()

export const aiChatRequestSchema = z.object({
  task: aiTaskSchema.default('chat'),
  messages: z.array(aiMessageSchema).min(1).max(30),
  context: aiContextSchema,
  maxTokens: z.number().int().min(64).max(2048).default(600),
  temperature: z.number().min(0).max(1).default(0.2),
})

export type AiChatRequest = z.infer<typeof aiChatRequestSchema>

export type AiProviderName = 'openrouter' | 'mock'

export type AiGenerateInput = {
  task: AiTask
  messages: AiMessage[]
  maxTokens: number
  temperature: number
  /** Optional system prompt injected as the first system message. */
  systemPrompt?: string
}

export type AiGenerateResult = {
  text: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  meta: {
    provider: AiProviderName
    model: string
    task: AiTask
    latencyMs: number
    finishReason: string
  }
}

export type AiStreamChunk = {
  textDelta: string
}

export type AiStreamCallbacks = {
  onChunk: (chunk: AiStreamChunk) => Promise<void> | void
}

export interface AiProvider {
  name: AiProviderName
  generate(input: AiGenerateInput): Promise<AiGenerateResult>
  stream?(input: AiGenerateInput, callbacks: AiStreamCallbacks): Promise<AiGenerateResult>
}
