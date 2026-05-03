/**
 * Shared logic for building a board from a plan artifact.
 * Used by the materialize-board API route AND the capabilities chat command handler.
 */
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { boardContentToRow, computeContentHash } from '@/lib/board-helpers'
import {
  deriveBoardTitleFromPlanTitle,
  materializePlanWithAiScene,
  type PlanArtifactContent,
} from '@/lib/ai/plan-materializer'

export const BORDS_AI_PROFILE_ID = '00000000-0000-0000-0000-000000000001'

export type BuildBoardResult = {
  boardLocalId: string
  boardTitle: string
  organizationId: string | null
  conversationId: string
  materializationSource: 'ai_scene' | 'blueprint'
  reused: boolean
}

type ArtifactRow = {
  id: string
  conversation_id: string
  user_id: string
  organization_id: string | null
  title: string
  goal: string | null
  content: Record<string, unknown> | null
  status: string
}

function hasRenderableBoardContent(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false
  const sticky = Array.isArray(row.sticky_notes) ? row.sticky_notes.length : 0
  const checklist = Array.isArray(row.checklists) ? row.checklists.length : 0
  const text = Array.isArray(row.text_elements) ? row.text_elements.length : 0
  const kanban = Array.isArray(row.kanban_boards) ? row.kanban_boards.length : 0
  const tables = Array.isArray(row.tables) ? row.tables.length : 0
  const rich = Array.isArray(row.rich_texts) ? row.rich_texts.length : 0
  const drawings = Array.isArray(row.drawings) ? row.drawings.length : 0
  return sticky + checklist + text + kanban + tables + rich + drawings > 0
}

async function getPersonalWorkspaceId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .eq('owner_id', userId)
    .eq('type', 'personal')
    .maybeSingle()
  return data?.id ?? null
}

async function ensureOrgOwnerAccess(localBoardId: string, organizationId: string | null | undefined): Promise<void> {
  if (!organizationId) return
  const [{ data: org }, { data: bord }] = await Promise.all([
    supabaseAdmin.from('organizations').select('owner_id').eq('id', organizationId).maybeSingle(),
    supabaseAdmin.from('bords').select('id').eq('local_board_id', localBoardId).maybeSingle(),
  ])
  const ownerId = org?.owner_id
  const bordId = bord?.id
  if (!ownerId || !bordId) return
  await supabaseAdmin
    .from('bord_access_list')
    .upsert(
      { bord_id: bordId, user_id: ownerId, permission: 'edit' } as never,
      { onConflict: 'bord_id,user_id' },
    )
}

/**
 * Core function: builds a board from an approved (or draft) plan artifact.
 * Handles auto-approve, Supabase writes, and posts the confirmation message.
 * Returns board identifiers on success, throws on failure.
 */
export async function buildBoardFromPlanArtifact(
  artifact: ArtifactRow,
  userId: string,
  theme: 'dark' | 'light',
): Promise<BuildBoardResult> {
  const content = (artifact.content ?? {}) as Record<string, unknown>

  let reuseExistingLocalBoardId: string | null = null
  let shouldRebuildExistingBoard = false

  // If already applied and board exists, return the existing board
  if (artifact.status === 'applied' && content?.materializedBoard) {
    const mb = content.materializedBoard as Record<string, string>
    const localBoardId = mb.localBoardId
    if (localBoardId) {
      const { data: existingDoc } = await supabaseAdmin
        .from('board_documents')
        .select('sticky_notes, checklists, text_elements, kanban_boards, tables, rich_texts, drawings')
        .eq('local_board_id', localBoardId)
        .maybeSingle()

      if (hasRenderableBoardContent(existingDoc as Record<string, unknown> | null)) {
        await ensureOrgOwnerAccess(localBoardId, artifact.organization_id)
        return {
          boardLocalId: localBoardId,
          boardTitle: mb.title ?? artifact.title,
          organizationId: artifact.organization_id,
          conversationId: artifact.conversation_id,
          materializationSource: 'ai_scene',
          reused: true,
        }
      }

      // Existing applied board is empty/stale — rebuild it with fresh materialization.
      reuseExistingLocalBoardId = localBoardId
      shouldRebuildExistingBoard = true
    }
  }

  const boardTitle = deriveBoardTitleFromPlanTitle(artifact.title)
  const localBoardId = reuseExistingLocalBoardId ?? `ai-plan-${randomUUID()}`
  const contextType = artifact.organization_id ? 'organization' : 'personal'
  const workspaceId = await getPersonalWorkspaceId(userId)

  const planContent = content as PlanArtifactContent
  const { board: boardContent, source: materializationSource } = await materializePlanWithAiScene(
    planContent,
    boardTitle,
    localBoardId,
    { theme, goal: artifact.goal ?? '' },
  )
  const contentHash = computeContentHash(boardContent)

  if (shouldRebuildExistingBoard) {
    const nowIso = new Date().toISOString()
    const updateDoc = await supabaseAdmin
      .from('board_documents')
      .update({
        title: boardTitle,
        context_type: contextType,
        organization_id: artifact.organization_id,
        workspace_id: workspaceId,
        content_hash: contentHash,
        last_synced_at: nowIso,
        ...boardContentToRow(boardContent),
      } as never)
      .eq('local_board_id', localBoardId)
      .select('id')
      .maybeSingle()

    if (updateDoc.error) {
      throw new Error(updateDoc.error.message || 'Failed to rebuild existing board content')
    }

    if (!updateDoc.data?.id) {
      const { data: existingBord, error: existingBordErr } = await supabaseAdmin
        .from('bords')
        .select('id')
        .eq('local_board_id', localBoardId)
        .maybeSingle()
      if (existingBordErr) throw new Error(existingBordErr.message)

      if (!existingBord?.id) {
        const bordsInsert = await supabaseAdmin
          .from('bords')
          .insert({
            owner_id: userId,
            local_board_id: localBoardId,
            title: boardTitle,
            context_type: contextType,
            organization_id: artifact.organization_id,
          } as never)
        if (bordsInsert.error) throw new Error(bordsInsert.error.message)
      }

      const boardDocInsert = await supabaseAdmin
        .from('board_documents')
        .insert({
          owner_id: userId,
          local_board_id: localBoardId,
          title: boardTitle,
          context_type: contextType,
          organization_id: artifact.organization_id,
          workspace_id: workspaceId,
          visibility: 'private',
          shared_with: [],
          version: 1,
          content_hash: contentHash,
          last_synced_at: nowIso,
          ...boardContentToRow(boardContent),
        } as never)
      if (boardDocInsert.error) throw new Error(boardDocInsert.error.message)
    }
  } else {
    const [bordsInsert, boardDocInsert] = await Promise.all([
      supabaseAdmin
        .from('bords')
        .insert({
          owner_id: userId,
          local_board_id: localBoardId,
          title: boardTitle,
          context_type: contextType,
          organization_id: artifact.organization_id,
        } as never)
        .select('id')
        .single(),
      supabaseAdmin
        .from('board_documents')
        .insert({
          owner_id: userId,
          local_board_id: localBoardId,
          title: boardTitle,
          context_type: contextType,
          organization_id: artifact.organization_id,
          workspace_id: workspaceId,
          visibility: 'private',
          shared_with: [],
          version: 1,
          content_hash: contentHash,
          last_synced_at: new Date().toISOString(),
          ...boardContentToRow(boardContent),
        } as never),
    ])

    if (bordsInsert.error || boardDocInsert.error) {
      throw new Error(bordsInsert.error?.message || boardDocInsert.error?.message || 'Failed to create board')
    }
  }

  await ensureOrgOwnerAccess(localBoardId, artifact.organization_id)

  const nextContent = {
    ...(content ?? {}),
    materializedBoard: { localBoardId, title: boardTitle, createdAt: new Date().toISOString() },
  }

  // Auto-approve draft → applied
  await supabaseAdmin
    .from('ai_plan_artifacts')
    .update({ status: 'applied', content: nextContent } as never)
    .eq('id', artifact.id)

  const workstreamCount = Array.isArray(content.workstreams) ? content.workstreams.length : 0
  const outcomeCount = Array.isArray(content.outcomes) ? content.outcomes.length : 0
  const confirmationText = [
    `Your board **${boardTitle}** is ready! 🎉`,
    '',
    `I've set up the full execution workspace with ${workstreamCount} workstream${workstreamCount === 1 ? '' : 's'} and ${outcomeCount} outcome${outcomeCount === 1 ? '' : 's'}.`,
    '',
    'You can now:',
    '- **Open the board** to see your sticky notes, kanban workflow, and rich text overview',
    '- **Assign team members** to tasks from the plan review',
    '- Ask me to make changes to the plan anytime',
  ].join('\n')

  const confirmationMeta = {
    model: 'bords-capability',
    provider: 'bords',
    task: 'chat',
    latencyMs: 0,
    capability: 'board_created',
    capabilityData: {
      boardLocalId: localBoardId,
      boardTitle,
      organizationId: artifact.organization_id ?? null,
      planArtifactId: artifact.id,
    },
  }

  await supabaseAdmin
    .from('messages')
    .insert({
      conversation_id: artifact.conversation_id,
      sender_id: BORDS_AI_PROFILE_ID,
      content: confirmationText,
      is_ai_message: true,
      metadata: confirmationMeta,
    } as never)
    .select('id')
    .single()
    .then(async ({ error }) => {
      if (error?.message?.includes("Could not find the 'metadata' column")) {
        await supabaseAdmin.from('messages').insert({
          conversation_id: artifact.conversation_id,
          sender_id: BORDS_AI_PROFILE_ID,
          content: confirmationText,
          is_ai_message: true,
        } as never)
      }
    })

  await supabaseAdmin
    .from('conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', artifact.conversation_id)

  return {
    boardLocalId: localBoardId,
    boardTitle,
    organizationId: artifact.organization_id,
    conversationId: artifact.conversation_id,
    materializationSource,
    reused: false,
  }
}
