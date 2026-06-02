import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { badRequest, forbidden, getAuthUser, unauthorized } from '@/lib/api-helpers'
import { createTaskAssignment } from '@/lib/task-assignments'

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
 *   scope  = 'mine' | 'org' (default: 'mine')
 */
export async function GET(request: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { searchParams } = request.nextUrl
  const filter = searchParams.get('filter') || 'all'
  const sort = searchParams.get('sort') || 'due-date'
  const orgId = searchParams.get('orgId') || null
  const scope = searchParams.get('scope') || 'mine'

  let canViewOrgScope = false
  if (orgId && scope === 'org') {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('id, owner_id')
      .eq('id', orgId)
      .maybeSingle()

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    if (org.owner_id === user.id) {
      canViewOrgScope = true
    } else {
      const { data: membership } = await supabaseAdmin
        .from('employee_memberships')
        .select('id, role')
        .eq('organization_id', orgId)
        .eq('user_id', user.id)
        .maybeSingle()
      canViewOrgScope = membership?.role === 'admin'
    }

    if (!canViewOrgScope) return forbidden()
  }

  // ── Step 1: Collect all board local_board_ids the user can access ──

  let accessibleBoardIds: Set<string>
  // Track org-context board local_board_ids separately so the owner fallback
  // ("unassigned task → show to board owner") can be suppressed for org boards.
  // Org board tasks must reach employees via explicit assignments, not the fallback.
  const orgBoardIds = new Set<string>()

  if (orgId) {
    // Org-scoped: get boards in this org that the user can access
    const { data: orgBords } = await supabaseAdmin
      .from('bords')
      .select('local_board_id')
      .eq('organization_id', orgId)
      .eq('context_type', 'organization')

    accessibleBoardIds = new Set((orgBords || []).map((b: any) => b.local_board_id))
    for (const id of accessibleBoardIds) orgBoardIds.add(id)
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
        .from('employee_memberships')
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
        orgBoardIds.add(b.local_board_id)
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
      .select('id, content, source_type, source_id, priority, due_date, status, completed_at, is_deleted, bord_id, assigned_to, column_id, column_title, available_columns, employee_updates, bords(local_board_id, title)')
        .eq('is_deleted', false)
      .eq('organization_id', orgId)
    : supabaseAdmin
        .from('task_assignments')
        .select('id, content, source_type, source_id, priority, due_date, status, completed_at, is_deleted, bord_id, assigned_to, column_id, column_title, available_columns, employee_updates, bords(local_board_id, title)')
        .eq('assigned_to', user.id)
        .eq('is_deleted', false)

  if (orgId && scope !== 'org') {
    assignmentFilter.eq('assigned_to', user.id)
  }

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
    assignedToName: string | null
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
          return scope === 'org' && orgId ? true : t.assignedTo === user.id
        }
        // For org boards, unassigned items must not fall back to the owner.
        // They should only appear once explicitly assigned via task_assignments.
        if (orgBoardIds.has(row.board_id)) return false
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
        assignedToName: null,
        boardId: row.board_id,
        boardTitle: row.title || 'Untitled Board',
        source: 'board' as const,
      }))
  })

  // From task_assignments (assigned to the current user)
  for (const a of assignments || []) {
    const bord = a.bords as any
    const employeeUpdates = (a.employee_updates || {}) as { columnId?: string | null; columnTitle?: string | null }
    const effectiveColumnId = employeeUpdates.columnId ?? a.column_id ?? null
    const effectiveColumnTitle = employeeUpdates.columnTitle ?? a.column_title ?? null
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
      columnId: effectiveColumnId,
      columnTitle: effectiveColumnTitle,
      availableColumns: a.available_columns || null,
      assignedTo: a.assigned_to || null,
      assignedToName: null,
      boardId: bord?.local_board_id || '',
      boardTitle: bord?.title || 'Assigned Task',
      source: 'assignment' as const,
    })
  }

  // Resolve assignee display names for org scope
  if (scope === 'org' && orgId) {
    const assigneeIds = Array.from(new Set(tasks.map((t) => t.assignedTo).filter(Boolean) as string[]))
    if (assigneeIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, email, first_name, last_name')
        .in('id', assigneeIds)

      const nameMap = new Map<string, string>()
      for (const p of profiles || []) {
        const fullName = `${p.first_name || ''} ${p.last_name || ''}`.trim()
        nameMap.set(p.id, fullName || p.email || 'Unknown user')
      }

      tasks = tasks.map((t) => ({
        ...t,
        assignedToName: t.assignedTo ? (nameMap.get(t.assignedTo) || t.assignedTo) : null,
      }))
    }
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

/**
 * POST /api/dashboard/my-tasks
 * Quick-create org assignment from tasks page.
 * Body: { orgId, assignedTo, content, taskType, priority?, dueDate? }
 */
export async function POST(request: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await request.json().catch(() => ({}))
  const orgId = typeof body.orgId === 'string' ? body.orgId : ''
  const assignedTo = typeof body.assignedTo === 'string' ? body.assignedTo : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const taskType = body.taskType === 'kanban' ? 'kanban' : 'checklist'
  const priority = body.priority === 'high' || body.priority === 'low' ? body.priority : 'normal'
  const dueDate = typeof body.dueDate === 'string' && body.dueDate ? body.dueDate : null

  if (!orgId || !assignedTo || !content) {
    return badRequest('orgId, assignedTo and content are required')
  }

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, owner_id')
    .eq('id', orgId)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  let canAssign = org.owner_id === user.id
  if (!canAssign) {
    const { data: membership } = await supabaseAdmin
      .from('employee_memberships')
      .select('id, role')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()
    canAssign = membership?.role === 'admin'
  }

  if (!canAssign) return forbidden()

  const isAssigneeOrgOwner = org.owner_id === assignedTo
  let isAssigneeMember = false
  if (!isAssigneeOrgOwner) {
    const { data: assigneeMembership } = await supabaseAdmin
      .from('employee_memberships')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', assignedTo)
      .maybeSingle()
    isAssigneeMember = !!assigneeMembership
  }

  if (!isAssigneeOrgOwner && !isAssigneeMember) {
    return badRequest('Assignee must be a member of this organization')
  }

  const now = Date.now()
  const sourceType = taskType === 'kanban' ? 'kanban_task' : 'checklist_item'
  const sourceId = `org_tasks:${taskType}:${orgId}:${now}`
  const availableColumns = taskType === 'kanban'
    ? [
        { id: 'backlog', title: 'Backlog' },
        { id: 'in_progress', title: 'In Progress' },
        { id: 'review', title: 'Review' },
        { id: 'done', title: 'Done' },
      ]
    : []

  const assignment = await createTaskAssignment({
    actorName: user.name,
    assignment: {
      bordId: null,
      workspaceId: null,
      organizationId: orgId,
      contextType: 'organization',
      sourceType,
      sourceId,
      content,
      assignedTo,
      assignedBy: user.id,
      priority,
      dueDate,
      status: 'assigned',
      columnId: taskType === 'kanban' ? 'backlog' : null,
      columnTitle: taskType === 'kanban' ? 'Backlog' : null,
      availableColumns,
    },
    notify: true,
    notifyBestEffort: true,
  })

  return NextResponse.json({ ok: true, assignmentId: assignment.id }, { status: 201 })
}
