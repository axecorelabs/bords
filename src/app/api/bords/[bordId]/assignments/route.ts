import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'

// GET /api/bords/[bordId]/assignments — list assignments for a bord
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bordId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { bordId } = await params

  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id')
    .eq('id', bordId)
    .maybeSingle()
  if (!bord) return notFound('Bord')

  const isOwner = bord.owner_id === user.id

  // Allow owner or collaborators (access list / assignees on this bord)
  if (!isOwner) {
    const { data: accessEntry } = await supabaseAdmin
      .from('bord_access_list')
      .select('id')
      .eq('bord_id', bordId)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!accessEntry) {
      // Also allow if user has any assignments on this bord
      const { data: assignmentEntry } = await supabaseAdmin
        .from('task_assignments')
        .select('id')
        .eq('bord_id', bordId)
        .eq('assigned_to', user.id)
        .eq('is_deleted', false)
        .limit(1)
        .maybeSingle()

      if (!assignmentEntry) return forbidden()
    }
  }

  // Owner sees all assignments; collaborators see only their own
  let assignmentQuery = supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('bord_id', bordId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  if (!isOwner) {
    assignmentQuery = assignmentQuery.or(`assigned_to.eq.${user.id},assigned_by.eq.${user.id}`)
  }

  const { data: assignments } = await assignmentQuery

  // Fetch profiles for assignedTo and assignedBy
  const userIds = new Set<string>()
  for (const a of assignments || []) {
    if (a.assigned_to) userIds.add(a.assigned_to)
    if (a.assigned_by) userIds.add(a.assigned_by)
  }
  const { data: profiles } = userIds.size > 0
    ? await supabaseAdmin.from('profiles').select('id, email, first_name, last_name, image').in('id', [...userIds])
    : { data: [] }
  const profileMap = new Map((profiles || []).map(p => [p.id, p]))

  const { data: tracker } = await supabaseAdmin
    .from('unpublished_change_tracker')
    .select('change_count, last_modified_at')
    .eq('bord_id', bordId)
    .maybeSingle()

  return NextResponse.json({
    assignments: (assignments || []).map((a: any) => {
      const assignee = profileMap.get(a.assigned_to)
      const assigner = profileMap.get(a.assigned_by)
      return {
        _id: a.id,
        bordId: a.bord_id,
        sourceType: a.source_type,
        sourceId: a.source_id,
        content: a.content,
        assignedTo: a.assigned_to,
        assignedBy: a.assigned_by,
        priority: a.priority,
        dueDate: a.due_date || null,
        executionNote: a.execution_note,
        status: a.status,
        publishedAt: a.published_at || null,
        completedAt: a.completed_at || null,
        isDeleted: a.is_deleted,
        columnId: a.column_id || null,
        columnTitle: a.column_title || null,
        availableColumns: a.available_columns || [],
        employeeUpdates: a.employee_updates?.updatedAt ? {
          content: a.employee_updates.content,
          columnId: a.employee_updates.columnId,
          columnTitle: a.employee_updates.columnTitle,
          updatedAt: a.employee_updates.updatedAt,
        } : undefined,
        createdAt: a.created_at,
        assignee: assignee ? {
          _id: assignee.id,
          email: assignee.email,
          firstName: assignee.first_name,
          lastName: assignee.last_name,
          image: assignee.image,
        } : undefined,
        assigner: assigner ? {
          _id: assigner.id,
          firstName: assigner.first_name,
          lastName: assigner.last_name,
        } : undefined,
      }
    }),
    unpublishedChanges: tracker
      ? { changeCount: tracker.change_count, lastModifiedAt: tracker.last_modified_at }
      : { changeCount: 0, lastModifiedAt: null },
  })
}

// POST /api/bords/[bordId]/assignments — create a new assignment (draft)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bordId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { bordId } = await params
  const body = await req.json()
  const { sourceType, sourceId, content, assignedTo, priority, dueDate, executionNote, columnId, columnTitle, availableColumns } = body

  if (!sourceType || !sourceId || !content?.trim() || !assignedTo) {
    return badRequest('sourceType, sourceId, content, and assignedTo are required')
  }

  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id, context_type, organization_id')
    .eq('id', bordId)
    .maybeSingle()
  if (!bord) return notFound('Bord')
  if (bord.owner_id !== user.id) return forbidden()

  // For kanban tasks: only one employee can be assigned at a time
  if (sourceType === 'kanban_task') {
    const { data: existingKanban } = await supabaseAdmin
      .from('task_assignments')
      .select('id, assigned_to')
      .eq('bord_id', bordId)
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .eq('is_deleted', false)
      .neq('status', 'completed')
      .maybeSingle()
    if (existingKanban && existingKanban.assigned_to !== assignedTo) {
      // Retire the displaced assignment instead of blocking the re-assign
      await supabaseAdmin
        .from('task_assignments')
        .update({ is_deleted: true })
        .eq('id', existingKanban.id)
    }
  }

  // Check if this exact employee already has an active assignment on this source
  const { data: existingAssignment } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('bord_id', bordId)
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('assigned_to', assignedTo)
    .eq('is_deleted', false)
    .neq('status', 'completed')
    .maybeSingle()

  if (existingAssignment) {
    // Same employee re-assigned — update existing
    const updateData: Record<string, any> = {
      content: content.trim(),
      priority: priority || 'normal',
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      execution_note: executionNote || null,
      status: 'draft',
      published_at: null,
      context_type: (bord as any).context_type || 'personal',
      organization_id: (bord as any).organization_id || null,
    }
    if (columnId !== undefined) updateData.column_id = columnId || null
    if (columnTitle !== undefined) updateData.column_title = columnTitle || null
    if (availableColumns) updateData.available_columns = availableColumns

    const { data: updated } = await supabaseAdmin
      .from('task_assignments')
      .update(updateData)
      .eq('id', existingAssignment.id)
      .select()
      .single()

    await supabaseAdmin
      .from('unpublished_change_tracker')
      .upsert(
        { bord_id: bordId, change_count: (existingAssignment as any).__change_count || 1, last_modified_at: new Date().toISOString() },
        { onConflict: 'bord_id' }
      )

    // Increment change count
    try {
      await supabaseAdmin.rpc('increment_change_count' as any, { p_bord_id: bordId })
    } catch {
      // Fallback: just upsert
      await supabaseAdmin
        .from('unpublished_change_tracker')
        .upsert({ bord_id: bordId, change_count: 1, last_modified_at: new Date().toISOString() }, { onConflict: 'bord_id' })
    }

    return NextResponse.json({
      assignment: {
        _id: updated!.id,
        bordId: updated!.bord_id || bordId,
        sourceType: updated!.source_type,
        sourceId: updated!.source_id,
        content: updated!.content,
        assignedTo: updated!.assigned_to,
        assignedBy: updated!.assigned_by,
        priority: updated!.priority,
        dueDate: updated!.due_date || null,
        executionNote: updated!.execution_note,
        status: updated!.status,
        createdAt: updated!.created_at,
      },
    })
  }

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .insert({
      bord_id: bordId,
      source_type: sourceType,
      source_id: sourceId,
      content: content.trim(),
      assigned_to: assignedTo,
      assigned_by: user.id,
      priority: priority || 'normal',
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      execution_note: executionNote || null,
      status: 'draft',
      context_type: (bord as any).context_type || 'personal',
      organization_id: (bord as any).organization_id || null,
      column_id: columnId || null,
      column_title: columnTitle || null,
      available_columns: availableColumns || [],
    })
    .select()
    .single()

  // Increment unpublished change tracker
  const { data: existingTracker } = await supabaseAdmin
    .from('unpublished_change_tracker')
    .select('change_count')
    .eq('bord_id', bordId)
    .maybeSingle()

  await supabaseAdmin
    .from('unpublished_change_tracker')
    .upsert(
      { bord_id: bordId, change_count: (existingTracker?.change_count || 0) + 1, last_modified_at: new Date().toISOString() },
      { onConflict: 'bord_id' }
    )

  return NextResponse.json({
    assignment: {
      _id: assignment!.id,
      bordId: assignment!.bord_id || bordId,
      sourceType: assignment!.source_type,
      sourceId: assignment!.source_id,
      content: assignment!.content,
      assignedTo: assignment!.assigned_to,
      assignedBy: assignment!.assigned_by,
      priority: assignment!.priority,
      dueDate: assignment!.due_date || null,
      executionNote: assignment!.execution_note,
      status: assignment!.status,
      createdAt: assignment!.created_at,
    },
  }, { status: 201 })
}
