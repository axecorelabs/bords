import { supabaseAdmin } from '@/lib/supabase/admin'
import { generateEmbedding } from '@/lib/ai/embeddings'
import { buildRetrievalCacheKey, getJsonCache, setJsonCache, shortHash } from '@/lib/ai/cache'
import { recordAiEvent } from '@/lib/ai/metrics'

export type Role = 'owner' | 'admin' | 'member' | 'none'

export type RetrievedChunk = {
  chunkId: string
  sourceId: string
  bordId: string | null
  organizationId: string | null
  content: string
  sourceType: 'task_assignment' | 'board_document'
  vectorScore: number
  lexicalScore: number
  hybridScore: number
}

export function scopeRetrievalBoardIds(allowedBoardIds: string[], taggedBoardIds: string[]): string[] {
  if (taggedBoardIds.length === 0) return allowedBoardIds
  const allowed = new Set(allowedBoardIds)
  return taggedBoardIds.filter((boardId) => allowed.has(boardId))
}

export async function resolveOrgRole(userId: string, orgId: string | null): Promise<Role> {
  if (!orgId) return 'none'

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('owner_id')
    .eq('id', orgId)
    .maybeSingle()

  if (org?.owner_id === userId) return 'owner'

  const { data: membership } = await supabaseAdmin
    .from('employee_memberships')
    .select('role')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()

  if (membership?.role === 'admin') return 'admin'
  if (membership) return 'member'
  return 'none'
}

export async function resolveAllowedBoardIds(userId: string, orgId: string | null, role: Role): Promise<string[]> {
  if (orgId && (role === 'owner' || role === 'admin')) {
    const { data } = await supabaseAdmin.from('bords').select('id').eq('organization_id', orgId)
    return (data ?? []).map((b) => b.id)
  }

  const { data: directAccess } = await supabaseAdmin
    .from('bord_access_list')
    .select('bord_id')
    .eq('user_id', userId)

  const candidateIds = (directAccess ?? []).map((x) => x.bord_id)

  const { data: owned } = await supabaseAdmin.from('bords').select('id').eq('owner_id', userId)
  for (const o of owned ?? []) candidateIds.push(o.id)

  const scoped = [...new Set(candidateIds)]
  if (scoped.length === 0) return []

  let q = supabaseAdmin.from('bords').select('id').in('id', scoped)
  if (orgId) q = q.eq('organization_id', orgId)
  else q = q.is('organization_id', null)

  const { data: boards } = await q
  return (boards ?? []).map((b) => b.id)
}

export async function retrieveHybridContext(params: {
  userId: string
  orgId: string | null
  role: Role
  allowedBoardIds: string[]
  query: string
  limit?: number
}): Promise<RetrievedChunk[]> {
  const q = params.query.trim()
  if (!q) return []

  const queryEmbedding = await generateEmbedding(q)
  const queryEmbeddingHash = shortHash(queryEmbedding.map((v) => v.toFixed(4)).join(','))

  const cacheKey = buildRetrievalCacheKey({
    userId: params.userId,
    orgId: params.orgId,
    role: params.role,
    boardIds: params.allowedBoardIds,
    queryEmbeddingHash,
  })

  const cached = await getJsonCache<RetrievedChunk[]>(cacheKey)
  if (cached) {
    await recordAiEvent('retrieval_cache_hit')
    return cached
  }
  await recordAiEvent('retrieval_cache_miss')

  const totalLimit = params.limit ?? 8
  const boardLimit = params.allowedBoardIds.length > 0 ? Math.min(6, totalLimit) : Math.min(3, totalLimit)
  const taskLimit = Math.max(2, totalLimit)

  const [taskResult, boardResult] = await Promise.all([
    supabaseAdmin.rpc('ai_hybrid_task_retrieve', {
      p_query_embedding: `[${queryEmbedding.join(',')}]`,
      p_query_text: q,
      p_user_id: params.userId,
      p_org_id: params.orgId,
      p_role: params.role,
      p_allowed_board_ids: params.allowedBoardIds,
      p_limit: taskLimit,
    } as never),
    supabaseAdmin.rpc('ai_hybrid_board_retrieve', {
      p_query_embedding: `[${queryEmbedding.join(',')}]`,
      p_query_text: q,
      p_org_id: params.orgId,
      p_allowed_board_ids: params.allowedBoardIds,
      p_limit: boardLimit,
    } as never),
  ])

  const taskRows = taskResult.error || !taskResult.data ? [] : (taskResult.data as any[])
  const boardRows = boardResult.error || !boardResult.data ? [] : (boardResult.data as any[])

  const result: RetrievedChunk[] = [
    ...taskRows.map((r) => ({
      chunkId: r.chunk_id,
      sourceId: r.source_id,
      bordId: r.bord_id,
      organizationId: r.organization_id,
      content: r.content,
      sourceType: 'task_assignment' as const,
      vectorScore: r.vector_score,
      lexicalScore: r.lexical_score,
      hybridScore: r.hybrid_score,
    })),
    ...boardRows.map((r) => ({
      chunkId: r.chunk_id,
      sourceId: r.source_id,
      bordId: r.bord_id,
      organizationId: r.organization_id,
      content: r.content,
      sourceType: 'board_document' as const,
      vectorScore: r.vector_score,
      lexicalScore: r.lexical_score,
      hybridScore: r.hybrid_score,
    })),
  ]
    .sort((left, right) => right.hybridScore - left.hybridScore)
    .slice(0, totalLimit)

  await setJsonCache(cacheKey, result, 90)
  return result
}

export function formatRetrievedChunks(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return ''
  const lines = ['## Retrieved workspace context']
  const maxTotalChars = 5200
  let usedChars = lines[0].length

  for (const c of chunks.slice(0, 8)) {
    const label = c.sourceType === 'board_document' ? 'board' : 'task'
    const header = `- [${label}] (score ${c.hybridScore.toFixed(3)})`
    const perChunkBudget = c.sourceType === 'board_document' ? 900 : 420
    const normalized = c.content.replace(/\r/g, '').trim()
    const snippet = normalized.slice(0, perChunkBudget)

    // Preserve line breaks so lists/tables (e.g., week-by-week roadmaps) are not flattened.
    const entry = `${header}\n${snippet}`
    if (usedChars + entry.length > maxTotalChars) break

    lines.push(entry)
    usedChars += entry.length
  }
  return lines.join('\n')
}
