import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'

/**
 * GET /api/dashboard/my-tasks
 *
 * Unified task list from two sources:
 *   1. board_metadata.tasks — items extracted from Y.Doc (checklists, kanban, reminders)
 *   2. task_assignments — explicitly assigned tasks (self-assigned or assigned by others)
 *
 * Query params:
 *   filter = 'all' | 'incomplete' | 'completed' | 'overdue' | 'due-soon'  (default: 'all')
 *   sort   = 'due-date' | 'board' | 'type' | 'recent'                     (default: 'due-date')
 *   orgId  = optional org ID to scope to a specific organization's boards
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { searchParams } = request.nextUrl
  const filter = searchParams.get('filter') || 'all'
  const sort = searchParams.get('sort') || 'due-date'
  const orgId = searchParams.get('orgId') || null

  // ── Step 1: Collect all board local_board_ids the user can access ──

  let accessibleBoardIds: Set<string>

  if (orgId) {
    // Org-scoped: get boards in this org that the user can access
    const { data: orgBords } = await supabaseAdmin
      .from('bords')
      .select('local_board_id')
      .eq('organization_id', orgId)
      .eq('context_type', 'organization')

    accessibleBoardIds = new Set((orgBords || []).map((b: any) => b.local_board_id))
  } else {
    // All-context: owned + collaborator + org member boards
    const [ownedRes, memberRes, accessRes, orgMembershipRes] = await Promise.all([
      // Boards the user created
      supabaseAdmin
        .from('bords')
        .select('local_board_id')
        .eq('owner_id', user.id),
      // Boards the user is a collaborator on
      supabaseAdmin
        .from('bord_members')
        .select('bord_id, bords!inner(local_board_id)')
        .eq('user_id', user.id),
      // Boards with explicit access grants
      supabaseAdmin
        .from('bord_access_list')
        .select('bord_id, bords!inner(local_board_id)')
        .eq('user_id', user.id),
      // Org memberships → all org boards
      supabaseAdmin
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', user.id),
    ])

    accessibleBoardIds = new Set<string>()

    // Owned
    for (const b of ownedRes.data || []) {
      accessibleBoardIds.add(b.local_board_id)
    }
    // Collaborator
    for (const b of memberRes.data || []) {
      const bord = b.bords as any
      if (bord?.local_board_id) accessibleBoardIds.add(bord.local_board_id)
    }
    // Explicit access
    for (const b of accessRes.data || []) {
      const bord = b.bords as any
      if (bord?.local_board_id) accessibleBoardIds.add(bord.local_board_id)
    }
    // Org boards
    const orgIds = (orgMembershipRes.data || []).map((m: any) => m.organization_id)

    // Also include orgs the user owns
    const { data: ownedOrgs } = await supabaseAdmin
      .from('organizations')
      .select('id')
      .eq('owner_id', user.id)

    for (const o of ownedOrgs || []) {
      if (!orgIds.includes(o.id)) orgIds.push(o.id)
    }

    if (orgIds.length > 0) {
      const { data: orgBords } = await supabaseAdmin
        .from('bords')
        .select('local_board_id')
        .in('organization_id', orgIds)
        .eq('context_type', 'organization')

      for (const b of orgBords || []) {
        accessibleBoardIds.add(b.local_board_id)
      }
    }
  }

  const boardIdArr = Array.from(accessibleBoardIds)

  // ── Step 2: Fetch board_metadata.tasks for accessible boards ──

  let metadataRows: any[] = []
  if (boardIdArr.length > 0) {
    // Supabase IN with large arrays — batch in chunks of 200
    for (let i = 0; i < boardIdArr.length; i += 200) {
      const chunk = boardIdArr.slice(i, i + 200)
      const { data } = await supabaseAdmin
        .from('board_metadata')
        .select('board_id, title, owner_id, tasks')
        .in('board_id', chunk)
        .not('tasks', 'eq', '[]')
      if (data) metadataRows.push(...data)
    }
  }

  // ── Step 3: Fetch explicit self-assigned + assigned-to-me task_assignments ──

  const assignmentFilter = orgId
    ? supabaseAdmin
        .from('task_assignments')
      .select('id, content, source_type, source_id, priority, due_date, status, completed_at, is_deleted, bord_id, column_id, column_title, available_columns, bords(local_board_id, title)')
        .eq('assigned_to', user.id)
        .eq('is_deleted', false)
      .eq('organization_id', orgId)
    : supabaseAdmin
        .from('task_assignments')
        .select('id, content, source_type, source_id, priority, due_date, status, completed_at, is_deleted, bord_id, column_id, column_title, available_columns, bords(local_board_id, title)')
        .eq('assigned_to', user.id)
        .eq('is_deleted', false)

  const { data: assignments } = await assignmentFilter

  // Build a set of assignment source IDs for dedup
  const assignmentSourceKeys = new Set(
    (assignments || []).map((a: any) => `${a.source_type}:${a.source_id}`)
  )

  // ── Step 4: Merge into unified task list ──

  const now = Date.now()
  const soonThreshold = now + 48 * 60 * 60 * 1000 // 48 hours

  interface TaskItem {
    itemId: string
    parentId: string
    parentType: string
    parentTitle: string
    text: string
    completed: boolean
    dueDate: string | null
    priority: string | null
    columnId: string | null
    columnTitle: string | null
    availableColumns: { id: string; title: string }[] | null
    assignedTo: string | null
    boardId: string
    boardTitle: string
    source: 'board' | 'assignment'
  }

  // From board_metadata.tasks
  // Rules:
  //   - If a task has assignedTo → only show it to that user
  //   - If a task has NO assignedTo → only show it to the board owner (creator)
  //   - Skip items that have an explicit task_assignment (assignment takes precedence)
  let tasks: TaskItem[] = metadataRows.flatMap((row: any) => {
    const boardTasks: any[] = row.tasks || []
    return boardTasks
      .filter((t: any) => {
        // Skip if there's an explicit assignment for this item
        const sourceType = t.parentType === 'checklist' ? 'checklist_item'
          : t.parentType === 'kanban' ? 'kanban_task'
          : 'reminder_item'
        if (assignmentSourceKeys.has(`${sourceType}:${t.itemId}`)) return false

        // Ownership rule: assigned tasks → assignee only; unassigned → board owner only
        if (t.assignedTo) {
          return t.assignedTo === user.id
        }
        return row.owner_id === user.id
      })
      .map((t: any) => ({
        itemId: t.itemId,
        parentId: t.parentId,
        parentType: t.parentType,
        parentTitle: t.parentTitle,
        text: t.text,
        completed: t.completed || false,
        dueDate: t.dueDate || null,
        priority: t.priority || null,
        columnId: t.columnId || null,
        columnTitle: t.columnTitle || null,
        availableColumns: t.availableColumns || null,
        assignedTo: t.assignedTo || null,
        boardId: row.board_id,
        boardTitle: row.title || 'Untitled Board',
        source: 'board' as const,
      }))
  })

  // From task_assignments (assigned to the current user)
  for (const a of assignments || []) {
    const bord = a.bords as any
    tasks.push({
      itemId: a.id,
      parentId: a.bord_id || '',
      parentType: a.source_type === 'checklist_item' ? 'checklist'
        : a.source_type === 'kanban_task' ? 'kanban'
        : a.source_type === 'reminder_item' ? 'reminder'
        : a.source_type,
      parentTitle: bord?.title || 'Assigned Task',
      text: a.content || '',
      completed: a.status === 'completed',
      dueDate: a.due_date || null,
      priority: a.priority || null,
      columnId: a.column_id || null,
      columnTitle: a.column_title || null,
      availableColumns: a.available_columns || null,
      assignedTo: user.id,
      boardId: bord?.local_board_id || '',
      boardTitle: bord?.title || 'Assigned Task',
      source: 'assignment' as const,
    })
  }

  // ── Step 5: Filter ──

  switch (filter) {
    case 'incomplete':
      tasks = tasks.filter((t) => !t.completed)
      break
    case 'completed':
      tasks = tasks.filter((t) => t.completed)
      break
    case 'overdue':
      tasks = tasks.filter((t) => !t.completed && t.dueDate && new Date(t.dueDate).getTime() < now)
      break
    case 'due-soon':
      tasks = tasks.filter(
        (t) => !t.completed && t.dueDate &&
          new Date(t.dueDate).getTime() >= now &&
          new Date(t.dueDate).getTime() <= soonThreshold
      )
      break
  }

  // ── Step 6: Sort ──

  switch (sort) {
    case 'due-date':
      tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1
        if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
        if (a.dueDate) return -1
        if (b.dueDate) return 1
        return 0
      })
      break
    case 'board':
      tasks.sort((a, b) => a.boardTitle.localeCompare(b.boardTitle))
      break
    case 'type':
      tasks.sort((a, b) => a.parentType.localeCompare(b.parentType))
      break
    case 'recent':
      tasks.sort((a, b) => {
        if (a.completed !== b.completed) return a.completed ? 1 : -1
        return 0
      })
      break
  }

  // ── Step 7: Summary stats ──

  const incomplete = tasks.filter((t) => !t.completed)
  const summary = {
    total: tasks.length,
    incomplete: incomplete.length,
    completed: tasks.length - incomplete.length,
    overdue: incomplete.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now).length,
    dueSoon: incomplete.filter(
      (t) => t.dueDate && new Date(t.dueDate).getTime() >= now && new Date(t.dueDate).getTime() <= soonThreshold
    ).length,
  }

  return NextResponse.json({ tasks, summary })
}
