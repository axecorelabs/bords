import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, badRequest } from '@/lib/api-helpers'

/**
 * GET /api/assignments/personal — list personal friend assignments for the current user
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { data: assignments } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('assigned_by', user.id)
    .eq('context_type', 'personal')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  // Fetch profiles
  const userIds = new Set<string>()
  for (const a of assignments || []) {
    if (a.assigned_to) userIds.add(a.assigned_to)
    if (a.assigned_by) userIds.add(a.assigned_by)
  }
  const { data: profiles } = userIds.size > 0
    ? await supabaseAdmin.from('profiles').select('id, email, first_name, last_name, image').in('id', [...userIds])
    : { data: [] }
  const profileMap = new Map((profiles || []).map(p => [p.id, p]))

  return NextResponse.json({
    assignments: (assignments || []).map((a: any) => {
      const assignee = profileMap.get(a.assigned_to)
      return {
        _id: a.id,
        bordId: null,
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
        contextType: 'personal',
        createdAt: a.created_at,
        assignee: assignee ? {
          _id: assignee.id,
          email: assignee.email,
          firstName: assignee.first_name,
          lastName: assignee.last_name,
          image: assignee.image,
        } : undefined,
      }
    }),
  })
}

/**
 * POST /api/assignments/personal — create a personal friend assignment
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const {
    sourceType, sourceId, content, assignedTo, priority, dueDate,
    executionNote, columnId, columnTitle, availableColumns, workspaceId,
  } = body

  if (!sourceType || !sourceId || !content?.trim() || !assignedTo) {
    return badRequest('sourceType, sourceId, content, and assignedTo are required')
  }

  // Validate that assignedTo is an accepted friend
  const { data: friendship } = await supabaseAdmin
    .from('friends')
    .select('id')
    .eq('friend_user_id', assignedTo)
    .eq('status', 'accepted')
    .maybeSingle()
  if (!friendship) {
    return NextResponse.json({ error: 'You can only assign tasks to accepted friends' }, { status: 400 })
  }

  // For kanban tasks: only one person at a time
  if (sourceType === 'kanban_task') {
    const { data: existing } = await supabaseAdmin
      .from('task_assignments')
      .select('id, assigned_to')
      .eq('assigned_by', user.id)
      .eq('context_type', 'personal')
      .eq('source_type', sourceType)
      .eq('source_id', sourceId)
      .eq('is_deleted', false)
      .neq('status', 'completed')
      .maybeSingle()
    if (existing && existing.assigned_to !== assignedTo) {
      return NextResponse.json(
        { error: 'Kanban tasks can only be assigned to one person. Remove the current assignee first.' },
        { status: 400 }
      )
    }
  }

  // Check for existing active assignment for same person + source
  const { data: existingAssignment } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('assigned_by', user.id)
    .eq('context_type', 'personal')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('assigned_to', assignedTo)
    .eq('is_deleted', false)
    .neq('status', 'completed')
    .maybeSingle()

  const now = new Date().toISOString()

  if (existingAssignment) {
    const updateData: Record<string, any> = {
      content: content.trim(),
      priority: priority || 'normal',
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      execution_note: executionNote || null,
      status: 'assigned',
      published_at: now,
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

    // Create notification
    if (assignedTo !== user.id) {
      const { data: sender } = await supabaseAdmin.from('profiles').select('first_name, last_name').eq('id', user.id).maybeSingle()
      const senderName = sender ? `${sender.first_name} ${sender.last_name}`.trim() : 'Someone'
      await supabaseAdmin.from('notifications').insert({
        user_id: assignedTo,
        type: 'task_assigned',
        title: 'Task Assigned',
        message: `${senderName} assigned you a task: "${content.trim().substring(0, 60)}${content.trim().length > 60 ? '...' : ''}"`,
        metadata: { taskAssignmentId: updated!.id, sourceType, sourceId },
      })
    }

    return NextResponse.json({
      assignment: {
        _id: updated!.id,
        bordId: null,
        sourceType: updated!.source_type,
        sourceId: updated!.source_id,
        content: updated!.content,
        assignedTo: updated!.assigned_to,
        assignedBy: updated!.assigned_by,
        priority: updated!.priority,
        dueDate: updated!.due_date || null,
        executionNote: updated!.execution_note,
        status: updated!.status,
        contextType: 'personal',
        createdAt: updated!.created_at,
      },
    })
  }

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .insert({
      bord_id: null,
      context_type: 'personal',
      workspace_id: workspaceId || null,
      source_type: sourceType,
      source_id: sourceId,
      content: content.trim(),
      assigned_to: assignedTo,
      assigned_by: user.id,
      priority: priority || 'normal',
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      execution_note: executionNote || null,
      status: 'assigned',
      published_at: now,
      column_id: columnId || null,
      column_title: columnTitle || null,
      available_columns: availableColumns || [],
    })
    .select()
    .single()

  // Create notification
  if (assignedTo !== user.id) {
    const { data: sender } = await supabaseAdmin.from('profiles').select('first_name, last_name').eq('id', user.id).maybeSingle()
    const senderName = sender ? `${sender.first_name} ${sender.last_name}`.trim() : 'Someone'
    await supabaseAdmin.from('notifications').insert({
      user_id: assignedTo,
      type: 'task_assigned',
      title: 'Task Assigned',
      message: `${senderName} assigned you a task: "${content.trim().substring(0, 60)}${content.trim().length > 60 ? '...' : ''}"`,
      metadata: { taskAssignmentId: assignment!.id, sourceType, sourceId },
    })
  }

  return NextResponse.json({
    assignment: {
      _id: assignment!.id,
      bordId: null,
      sourceType: assignment!.source_type,
      sourceId: assignment!.source_id,
      content: assignment!.content,
      assignedTo: assignment!.assigned_to,
      assignedBy: assignment!.assigned_by,
      priority: assignment!.priority,
      dueDate: assignment!.due_date || null,
      executionNote: assignment!.execution_note,
      status: assignment!.status,
      contextType: 'personal',
      createdAt: assignment!.created_at,
    },
  }, { status: 201 })
}
