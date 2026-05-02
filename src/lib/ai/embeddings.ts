import { getOpenRouterBaseUrl } from '@/lib/ai/model-policy'

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[] }>
}

const EMBED_MODEL = process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || 'openai/text-embedding-3-small'

function normalizeEmbedding(values: number[], expected = 1536): number[] {
  if (values.length === expected) return values
  if (values.length > expected) return values.slice(0, expected)
  return [...values, ...new Array(expected - values.length).fill(0)]
}

export async function generateEmbedding(input: string): Promise<number[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set for embeddings')
  }

  const res = await fetch(`${getOpenRouterBaseUrl()}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Embedding request failed (${res.status}): ${body.slice(0, 300)}`)
  }

  const payload = (await res.json()) as EmbeddingResponse
  const embedding = payload.data?.[0]?.embedding
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Embedding provider returned no embedding vector')
  }

  return normalizeEmbedding(embedding)
}

export function pgVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}
