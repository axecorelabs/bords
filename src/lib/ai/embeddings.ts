import { getOpenRouterBaseUrl } from '@/lib/ai/model-policy'

type EmbeddingResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>
}

const EMBED_MODEL = process.env.OPENROUTER_EMBEDDING_MODEL?.trim() || 'openai/text-embedding-3-small'

function normalizeEmbedding(values: number[], expected = 1536): number[] {
  if (values.length === expected) return values
  if (values.length > expected) return values.slice(0, expected)
  return [...values, ...new Array(expected - values.length).fill(0)]
}

async function callEmbeddingApi(input: string | string[]): Promise<EmbeddingResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set for embeddings')

  const res = await fetch(`${getOpenRouterBaseUrl()}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBED_MODEL, input }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Embedding request failed (${res.status}): ${body.slice(0, 300)}`)
  }

  return (await res.json()) as EmbeddingResponse
}

export async function generateEmbedding(input: string): Promise<number[]> {
  const payload = await callEmbeddingApi(input)
  const embedding = payload.data?.[0]?.embedding
  if (!embedding || !Array.isArray(embedding)) {
    throw new Error('Embedding provider returned no embedding vector')
  }
  return normalizeEmbedding(embedding)
}

/** Batch-embed multiple strings in a single API call. Returns embeddings in input order. */
export async function generateEmbeddings(inputs: string[]): Promise<number[][]> {
  if (inputs.length === 0) return []
  if (inputs.length === 1) return [await generateEmbedding(inputs[0])]

  const payload = await callEmbeddingApi(inputs)
  const items = payload.data
  if (!items || items.length === 0) {
    throw new Error('Embedding provider returned no embedding vectors')
  }

  // Results may arrive out of order — sort by index to align with input order
  const sorted = [...items].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  if (sorted.length !== inputs.length) {
    throw new Error(`Embedding API returned ${sorted.length} vectors for ${inputs.length} inputs`)
  }
  return sorted.map((item) => {
    if (!item.embedding || !Array.isArray(item.embedding)) {
      throw new Error('Embedding provider returned a null vector in batch response')
    }
    return normalizeEmbedding(item.embedding)
  })
}

export function pgVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`
}
