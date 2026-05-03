import { supabaseAdmin } from '@/lib/supabase/admin'
import { extractBoardContentFromYDoc } from '@/lib/ydoc-extract'
import { boardContentToRow, computeContentHash } from '@/lib/board-helpers'
import { redis } from '@/lib/redis'

const DIRTY_KEY = 'board_projection:dirty'

type YjsRow = {
  board_id: string
  state: string | null
  updated_at: string
}

type BordRow = {
  id: string
  owner_id: string
  local_board_id: string
  title: string
  context_type: string
  organization_id: string | null
  visibility: string
}

type BoardDocRow = {
  id: string
  version: number
  content_hash: string | null
  last_synced_at: string | null
}

function byteaToBase64(value: string): string {
  return value.startsWith('\\x')
    ? Buffer.from(value.slice(2), 'hex').toString('base64')
    : value
}

export async function processBoardProjectionJobs(batchSize = 20, lookbackMinutes = 180): Promise<{
  scanned: number
  projected: number
  skippedFresh: number
  skippedUnchanged: number
  skippedMissingBoard: number
  failed: number
}> {
  const limit = Math.max(1, Math.min(200, batchSize))

  // ── 1. Drain the Redis dirty set first (collab-server signal) ──
  // SPOP is O(count) and atomically removes entries so concurrent workers
  // don't double-process the same board.
  let priorityBoardIds: string[] = []
  if (redis) {
    try {
      const popped = await redis.spop(DIRTY_KEY, limit)
      if (Array.isArray(popped) && popped.length > 0) {
        priorityBoardIds = popped as string[]
      }
    } catch {
      // Redis unavailable — fall through to time-based polling
    }
  }

  // ── 2. Build the candidate Y.Doc row list ──
  let ydocs: YjsRow[] = []

  if (priorityBoardIds.length > 0) {
    // Fetch specific boards that the collab server flagged as dirty
    const { data } = await supabaseAdmin
      .from('yjs_documents')
      .select('board_id, state, updated_at')
      .in('board_id', priorityBoardIds)
    ydocs = (data as YjsRow[] | null) ?? []

    // Backfill any remaining capacity with time-based polling
    const remaining = limit - ydocs.length
    if (remaining > 0) {
      const lookbackIso = new Date(Date.now() - Math.max(1, lookbackMinutes) * 60_000).toISOString()
      const seen = new Set(ydocs.map((r) => r.board_id))
      const { data: polled } = await supabaseAdmin
        .from('yjs_documents')
        .select('board_id, state, updated_at')
        .gte('updated_at', lookbackIso)
        .not('board_id', 'in', `(${priorityBoardIds.map((id) => `"${id}"`).join(',')})`)
        .order('updated_at', { ascending: false })
        .limit(remaining)
      for (const row of (polled as YjsRow[] | null) ?? []) {
        if (!seen.has(row.board_id)) ydocs.push(row)
      }
    }
  } else {
    // Pure polling path — no dirty signals
    const lookbackIso = new Date(Date.now() - Math.max(1, lookbackMinutes) * 60_000).toISOString()
    const { data, error } = await supabaseAdmin
      .from('yjs_documents')
      .select('board_id, state, updated_at')
      .gte('updated_at', lookbackIso)
      .order('updated_at', { ascending: false })
      .limit(limit)
    if (error || !data?.length) {
      return { scanned: 0, projected: 0, skippedFresh: 0, skippedUnchanged: 0, skippedMissingBoard: 0, failed: 0 }
    }
    ydocs = data as YjsRow[]
  }

  if (!ydocs.length) {
    return { scanned: 0, projected: 0, skippedFresh: 0, skippedUnchanged: 0, skippedMissingBoard: 0, failed: 0 }
  }

  let projected = 0
  let skippedFresh = 0
  let skippedUnchanged = 0
  let skippedMissingBoard = 0
  let failed = 0

  const personalWorkspaceByOwner = new Map<string, string | null>()

  for (const row of ydocs as YjsRow[]) {
    try {
      if (!row.state) {
        continue
      }

      const { data: bord } = await supabaseAdmin
        .from('bords')
        .select('id, owner_id, local_board_id, title, context_type, organization_id, visibility')
        .eq('local_board_id', row.board_id)
        .maybeSingle()

      if (!bord) {
        skippedMissingBoard += 1
        continue
      }

      const canonicalBoard = bord as BordRow

      const { data: existingDoc } = await supabaseAdmin
        .from('board_documents')
        .select('id, version, content_hash, last_synced_at')
        .eq('local_board_id', row.board_id)
        .maybeSingle()

      const doc = (existingDoc as BoardDocRow | null) ?? null
      const yjsUpdatedAt = Date.parse(row.updated_at)
      const boardSyncedAt = doc?.last_synced_at ? Date.parse(doc.last_synced_at) : Number.NEGATIVE_INFINITY

      if (Number.isFinite(yjsUpdatedAt) && Number.isFinite(boardSyncedAt) && boardSyncedAt >= yjsUpdatedAt) {
        skippedFresh += 1
        continue
      }

      const extracted = extractBoardContentFromYDoc(byteaToBase64(row.state))
      const boardContent = {
        stickyNotes: extracted.stickyNotes,
        checklists: extracted.checklists,
        kanbanBoards: extracted.kanbanBoards,
        textElements: extracted.textElements,
        mediaItems: extracted.mediaItems,
        connections: extracted.connections,
        drawings: extracted.drawings,
        reminders: extracted.reminders,
        tables: extracted.tables,
        richTexts: extracted.richTexts,
        nativeTldraw: extracted.nativeTldraw,
      }

      const contentHash = computeContentHash(boardContent)
      const contentRow = boardContentToRow(boardContent)

      const canonicalContextType = canonicalBoard.context_type || 'personal'
      let workspaceId: string | null = null

      if (canonicalContextType === 'personal') {
        if (personalWorkspaceByOwner.has(canonicalBoard.owner_id)) {
          workspaceId = personalWorkspaceByOwner.get(canonicalBoard.owner_id) ?? null
        } else {
          const { data: personalWs } = await supabaseAdmin
            .from('workspaces')
            .select('id')
            .eq('owner_id', canonicalBoard.owner_id)
            .eq('type', 'personal')
            .maybeSingle()
          workspaceId = personalWs?.id || null
          personalWorkspaceByOwner.set(canonicalBoard.owner_id, workspaceId)
        }
      }

      const title = (extracted.boardMeta?.name as string) || canonicalBoard.title || row.board_id

      if (doc) {
        if (doc.content_hash === contentHash) {
          await supabaseAdmin
            .from('board_documents')
            .update({
              owner_id: canonicalBoard.owner_id,
              workspace_id: workspaceId,
              organization_id: canonicalBoard.organization_id,
              context_type: canonicalContextType,
              visibility: canonicalBoard.visibility || 'private',
              last_synced_at: new Date().toISOString(),
            } as never)
            .eq('id', doc.id)

          skippedUnchanged += 1
          continue
        }

        await supabaseAdmin
          .from('board_documents')
          .update({
            ...contentRow,
            title,
            owner_id: canonicalBoard.owner_id,
            workspace_id: workspaceId,
            organization_id: canonicalBoard.organization_id,
            context_type: canonicalContextType,
            visibility: canonicalBoard.visibility || 'private',
            content_hash: contentHash,
            last_synced_at: new Date().toISOString(),
            version: (doc.version || 0) + 1,
          } as never)
          .eq('id', doc.id)

        projected += 1
        continue
      }

      await supabaseAdmin
        .from('board_documents')
        .insert({
          ...contentRow,
          owner_id: canonicalBoard.owner_id,
          local_board_id: row.board_id,
          title,
          workspace_id: workspaceId,
          organization_id: canonicalBoard.organization_id,
          context_type: canonicalContextType,
          visibility: canonicalBoard.visibility || 'private',
          shared_with: [],
          content_hash: contentHash,
          last_synced_at: new Date().toISOString(),
          version: 1,
        } as never)

      projected += 1
    } catch {
      failed += 1
    }
  }

  return {
    scanned: ydocs.length,
    projected,
    skippedFresh,
    skippedUnchanged,
    skippedMissingBoard,
    failed,
  }
}
