import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'
import { boardContentToRow, computeContentHash } from '@/lib/board-helpers'
import { deriveBoardTitleFromPlanTitle, materializePlanToBoardContent } from '@/lib/ai/plan-materializer'
import { BORDS_AI_PROFILE_ID } from '@/app/api/ai/conversation/ensure/route'

type Params = { params: Promise<{ id: string }> }

async function assertConversationMember(conversationId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
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
    supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', organizationId)
      .maybeSingle(),
    supabaseAdmin
      .from('bords')
      .select('id')
      .eq('local_board_id', localBoardId)
      .maybeSingle(),
  ])

  const ownerId = org?.owner_id
  const bordId = bord?.id
  if (!ownerId || !bordId) return

  await supabaseAdmin
    .from('bord_access_list')
    .upsert({
      bord_id: bordId,
      user_id: ownerId,
      permission: 'edit',
    } as never, { onConflict: 'bord_id,user_id' })
}

export async function POST(_req: Request, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { id } = await params
  const { data: artifact, error: artifactErr } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .select('id, conversation_id, user_id, organization_id, title, goal, content, status')
    .eq('id', id)
    .maybeSingle()

  if (artifactErr || !artifact) {
    return NextResponse.json({ error: 'Plan artifact not found' }, { status: 404 })
  }

  const isMember = await assertConversationMember(artifact.conversation_id, user.id)
  if (!isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (artifact.status !== 'approved' && artifact.status !== 'applied') {
    return NextResponse.json({ error: 'Plan must be approved before board creation' }, { status: 400 })
  }

  const content = (artifact.content ?? {}) as Record<string, any>
  if (artifact.status === 'applied' && content?.materializedBoard?.localBoardId) {
    await ensureOrgOwnerAccess(content.materializedBoard.localBoardId, artifact.organization_id)
    return NextResponse.json({
      ok: true,
      boardLocalId: content.materializedBoard.localBoardId,
      boardTitle: content.materializedBoard.title ?? artifact.title,
      organizationId: artifact.organization_id ?? null,
      reused: true,
    })
  }

  const boardTitle = deriveBoardTitleFromPlanTitle(artifact.title)
  const localBoardId = `ai-plan-${randomUUID()}`
  const contextType = artifact.organization_id ? 'organization' : 'personal'
  const workspaceId = await getPersonalWorkspaceId(user.id)

  const boardContent = materializePlanToBoardContent(content as never, boardTitle, localBoardId)
  const contentHash = computeContentHash(boardContent)

  const [bordsInsert, boardDocInsert] = await Promise.all([
    supabaseAdmin
      .from('bords')
      .insert({
        owner_id: user.id,
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
        owner_id: user.id,
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
    return NextResponse.json({
      error: bordsInsert.error?.message || boardDocInsert.error?.message || 'Failed to create board from plan',
    }, { status: 500 })
  }

  await ensureOrgOwnerAccess(localBoardId, artifact.organization_id)

  const nextContent = {
    ...(content ?? {}),
    materializedBoard: {
      localBoardId,
      title: boardTitle,
      createdAt: new Date().toISOString(),
    },
  }

  await supabaseAdmin
    .from('ai_plan_artifacts')
    .update({ status: 'applied', content: nextContent } as never)
    .eq('id', artifact.id)

  // Post AI confirmation message into the conversation with a clickable board link
  const workstreamCount = Array.isArray(content.workstreams) ? content.workstreams.length : 0
  const outcomeCount = Array.isArray(content.outcomes) ? content.outcomes.length : 0
  const confirmationText = [
    `Your board **${boardTitle}** is ready! 🎉`,
    '',
    `I've set up the full execution workspace with ${workstreamCount} workstream${workstreamCount === 1 ? '' : 's'} and ${outcomeCount} outcome${outcomeCount === 1 ? '' : 's'}.`,
    '',
    'You can now:',
    '- **Open the board** to see your sticky notes, kanban workflow, and rich text overview',
    '- **Assign team members** to tasks from the plan review modal',
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
      // Fallback if metadata column not present
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

  return NextResponse.json({
    ok: true,
    boardLocalId: localBoardId,
    boardTitle,
    organizationId: artifact.organization_id ?? null,
    reused: false,
  })
}
