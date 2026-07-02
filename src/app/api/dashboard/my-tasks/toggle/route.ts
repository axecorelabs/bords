import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'
import { cacheInvalidatePattern } from '@/lib/cache'

/**
 * POST /api/dashboard/my-tasks/toggle
 *
 * Toggle completion or move kanban column for a task from My Tasks.
 *
 * Body:
 *   action?:    'toggle' (default) | 'move-column'
 *   source:     'board' | 'assignment'
 *   itemId:     assignment UUID (for 'assignment') or source item ID (for 'board')
 *   boardId?:   local_board_id — required for source='board'
 *   parentType?: 'checklist' | 'kanban' | 'reminder' — required for source='board'
 *   text?:      task text — used when creating a self-assignment
 *   completed:  current completed state (will be flipped for toggle)
 *   dueDate?:   ISO date string
 *   priority?:  'low' | 'normal' | 'high'
 *   columnId?:  kanban column ID
 *   columnTitle?: kanban column title
 *   availableColumns?: { id: string; title: string }[] — for creating self-assignment
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  // Every call to this route mutates task state — drop cached task lists immediately
  await cacheInvalidatePattern(`cache:my-tasks:${user.id}:*`)

  const body = await request.json()
  const {
    action = 'toggle',
    source, itemId, boardId, parentType, text, completed,
    dueDate, priority, columnId, columnTitle, availableColumns,
  } = body

  if (!source || !itemId) {
    return NextResponse.json({ error: 'source and itemId are required' }, { status: 400 })
  }

  const now = new Date().toISOString()

  async function moveAssignmentColumn(
    assignment: any,
    isAssignee: boolean,
    isAssigner: boolean,
    nextColumnId: string,
    nextColumnTitle: string,
  ) {
    const updateData: Record<string, any> = {}

    if (assignment.context_type === 'organization' && isAssignee && !isAssigner) {
      const employeeUpdates: Record<string, any> = { ...(assignment.employee_updates || {}) }
      employeeUpdates.columnId = nextColumnId
      employeeUpdates.columnTitle = nextColumnTitle
      employeeUpdates.updatedAt = new Date().toISOString()
      updateData.employee_updates = employeeUpdates
    } else {
      updateData.column_id = nextColumnId
      updateData.column_title = nextColumnTitle
    }

    const { data: updated } = await supabaseAdmin
      .from('task_assignments')
      .update(updateData)
      .eq('id', assignment.id)
      .select()
      .single()

    return {
      columnId: updated?.employee_updates?.columnId || updated?.column_id || nextColumnId,
      columnTitle: updated?.employee_updates?.columnTitle || updated?.column_title || nextColumnTitle,
    }
  }

  // ── Assignment-sourced tasks ──
  if (source === 'assignment') {
    const { data: assignment } = await supabaseAdmin
      .from('task_assignments')
      .select('*')
      .eq('id', itemId)
      .maybeSingle()

    if (!assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    }

    const isAssignee = assignment.assigned_to === user.id
    const isAssigner = assignment.assigned_by === user.id
    if (!isAssignee && !isAssigner) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // ── Column move ──
    if (action === 'move-column') {
      if (!columnId || !columnTitle) {
        return NextResponse.json({ error: 'columnId and columnTitle required for move-column' }, { status: 400 })
      }

      const moved = await moveAssignmentColumn(assignment, isAssignee, isAssigner, columnId, columnTitle)
      return NextResponse.json({
        completed: assignment.status === 'completed',
        assignmentId: assignment.id,
        columnId: moved.columnId,
        columnTitle: moved.columnTitle,
      })
    }

    // ── Toggle completion ──
    const wasCompleted = assignment.status === 'completed'
    const { data: updated } = await supabaseAdmin
      .from('task_assignments')
      .update(wasCompleted
        ? { status: 'assigned', completed_at: null }
        : { status: 'completed', completed_at: now }
      )
      .eq('id', itemId)
      .select()
      .single()

    // Notify the other party when completing
    if (!wasCompleted && assignment.bord_id) {
      const { data: bord } = await supabaseAdmin
        .from('bords')
        .select('id, owner_id, title, organization_id')
        .eq('id', assignment.bord_id)
        .maybeSingle()

      if (bord) {
        const notifyUserId = isAssigner ? assignment.assigned_to : bord.owner_id
        if (notifyUserId && notifyUserId !== user.id) {
          await supabaseAdmin.from('notifications').insert({
            user_id: notifyUserId,
            type: 'task_completed',
            title: 'Task Completed',
            message: `A task has been completed: "${assignment.content?.substring(0, 80)}"`,
            metadata: {
              bordId: bord.id,
              taskAssignmentId: assignment.id,
              bordTitle: bord.title,
              organizationId: bord.organization_id,
              sourceType: assignment.source_type,
              sourceId: assignment.source_id,
            },
          })
        }
      }
    }

    return NextResponse.json({
      completed: !wasCompleted,
      assignmentId: updated?.id,
    })
  }

  // ── Board-sourced tasks ──
  if (source === 'board') {
    if (!boardId || !parentType) {
      return NextResponse.json({ error: 'boardId and parentType required for board tasks' }, { status: 400 })
    }

    // Map parentType to source_type
    const sourceType = parentType === 'checklist' ? 'checklist_item'
      : parentType === 'kanban' ? 'kanban_task'
      : 'reminder_item'

    // Check for existing self-assignment
    const { data: existing } = await supabaseAdmin
      .from('task_assignments')
      .select('*')
      .eq('assigned_to', user.id)
      .eq('source_type', sourceType)
      .eq('source_id', itemId)
      .eq('is_deleted', false)
      .maybeSingle()

    if (existing) {
      // ── Column move on existing assignment ──
      if (action === 'move-column') {
        if (!columnId || !columnTitle) {
          return NextResponse.json({ error: 'columnId and columnTitle required for move-column' }, { status: 400 })
        }

        const isAssignee = existing.assigned_to === user.id
        const isAssigner = existing.assigned_by === user.id
        const moved = await moveAssignmentColumn(existing, isAssignee, isAssigner, columnId, columnTitle)

        return NextResponse.json({
          completed: existing.status === 'completed',
          assignmentId: existing.id,
          columnId: moved.columnId,
          columnTitle: moved.columnTitle,
        })
      }

      // ── Toggle existing assignment ──
      const wasCompleted = existing.status === 'completed'
      const { data: updated } = await supabaseAdmin
        .from('task_assignments')
        .update(wasCompleted
          ? { status: 'assigned', completed_at: null }
          : { status: 'completed', completed_at: now }
        )
        .eq('id', existing.id)
        .select()
        .single()

      return NextResponse.json({
        completed: !wasCompleted,
        assignmentId: updated?.id,
      })
    }

    // No existing assignment — create a self-assignment
    const { data: bord } = await supabaseAdmin
      .from('bords')
      .select('id, context_type, organization_id')
      .eq('local_board_id', boardId)
      .maybeSingle()

    const contextType = bord?.context_type || 'personal'
    const newCompleted = action === 'toggle' ? !completed : !!completed

    const insertData: Record<string, any> = {
      assigned_to: user.id,
      assigned_by: user.id,
      bord_id: bord?.id || null,
      source_type: sourceType,
      source_id: itemId,
      content: text || '',
      status: newCompleted ? 'completed' : 'assigned',
      completed_at: newCompleted ? now : null,
      context_type: contextType,
      priority: priority || 'normal',
      due_date: dueDate || null,
      is_deleted: false,
    }

    // For kanban tasks, store column info
    if (sourceType === 'kanban_task') {
      if (action === 'move-column' && columnId) {
        insertData.column_id = columnId
        insertData.column_title = columnTitle || null
      } else {
        insertData.column_id = body.columnId || null
        insertData.column_title = body.columnTitle || null
      }
      insertData.available_columns = availableColumns || null
    }

    const { data: created } = await supabaseAdmin
      .from('task_assignments')
      .insert(insertData)
      .select()
      .single()

    return NextResponse.json({
      completed: newCompleted,
      assignmentId: created?.id,
      ...(action === 'move-column' ? { columnId, columnTitle } : {}),
    })
  }

  return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
}
