import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

type ApprovalItem = {
  proposalIndex: number
  userId: string
  responsibility: string
}

export async function POST(req: Request, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { id } = await params
  let body: { approvals?: ApprovalItem[] }
  try {
    body = await req.json()
  } catch {
    return badRequest('Invalid JSON body')
  }

  const approvals: ApprovalItem[] = Array.isArray(body?.approvals) ? body.approvals : []
  if (approvals.length === 0) {
    return NextResponse.json({ error: 'No approvals provided' }, { status: 400 })
  }

  // Load the plan artifact
  const { data: artifact, error: artifactErr } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .select('id, conversation_id, user_id, organization_id, content, status')
    .eq('id', id)
    .maybeSingle()

  if (artifactErr || !artifact) {
    return NextResponse.json({ error: 'Plan artifact not found' }, { status: 404 })
  }

  // Verify membership
  const { data: membership } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', artifact.conversation_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (artifact.status !== 'applied') {
    return NextResponse.json({ error: 'Board must be created from the plan before applying assignments' }, { status: 400 })
  }

  const content = (artifact.content ?? {}) as Record<string, any>
  const localBoardId: string | undefined = content?.materializedBoard?.localBoardId

  if (!localBoardId) {
    return NextResponse.json({ error: 'Materialized board not found in plan artifact' }, { status: 400 })
  }

  // Get the bords UUID from localBoardId
  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, organization_id, workspace_id')
    .eq('local_board_id', localBoardId)
    .maybeSingle()

  if (!bord) {
    return NextResponse.json({ error: 'Board not found' }, { status: 404 })
  }

  // Validate that each userId is a real org member (if org plan)
  let validUserIds: Set<string> = new Set(approvals.map((a) => a.userId))
  if (artifact.organization_id) {
    const { data: empRows } = await supabaseAdmin
      .from('employee_memberships')
      .select('user_id')
      .eq('organization_id', artifact.organization_id)
      .in('user_id', Array.from(validUserIds))

    const confirmedIds = new Set((empRows ?? []).map((r: any) => r.user_id as string))
    validUserIds = confirmedIds
  }

  // Build task_assignment inserts
  const rows = approvals
    .filter((a) => validUserIds.has(a.userId) && a.responsibility?.trim())
    .map((a) => ({
      id: randomUUID(),
      bord_id: bord.id as string,
      workspace_id: bord.workspace_id as string | null,
      organization_id: bord.organization_id as string | null,
      context_type: bord.organization_id ? 'organization' : 'personal',
      source_type: 'kanban_task',
      source_id: `ai-proposal-${a.proposalIndex}-${randomUUID().slice(0, 8)}`,
      content: a.responsibility.trim().slice(0, 1000),
      assigned_to: a.userId,
      assigned_by: user.id,
      priority: 'normal',
      status: 'assigned',
    }))

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No valid assignments to apply' }, { status: 400 })
  }

  const { error: insertErr } = await supabaseAdmin
    .from('task_assignments')
    .insert(rows as never[])

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message || 'Failed to apply assignments' }, { status: 500 })
  }

  // Record applied assignments in artifact metadata
  const existingApplied: ApprovalItem[] = Array.isArray(content?.appliedAssignments) ? content.appliedAssignments : []
  await supabaseAdmin
    .from('ai_plan_artifacts')
    .update({
      content: {
        ...content,
        appliedAssignments: [...existingApplied, ...approvals],
      },
    } as never)
    .eq('id', artifact.id)

  return NextResponse.json({ ok: true, created: rows.length })
}
