import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'

// GET /api/execution/tasks — get all assigned tasks for the current (employee) user
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req)
  if (!user) return unauthorized()

  const { searchParams } = new URL(req.url)
  const offset = Math.max(0, Number(searchParams.get('offset') || '0') || 0)
  const requestedLimit = Number(searchParams.get('limit') || '200') || 200
  const limit = Math.min(Math.max(1, requestedLimit), 500)

  // Get all orgs the user is an employee of
  const { data: memberships } = await supabaseAdmin
    .from('employee_memberships')
    .select('organization_id, organizations(id, name)')
    .eq('user_id', user.id)

  const orgMap = new Map<string, any>()
  for (const m of memberships || []) {
    const org = (m as any).organizations
    if (org) {
      orgMap.set(org.id, { _id: org.id, name: org.name })
    }
  }

  // Get all active org assignments for this user
  const { data: assignments } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('assigned_to', user.id)
    .eq('context_type', 'organization')
    .in('status', ['assigned', 'completed'])
    .eq('is_deleted', false)
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  // Fetch bord info and assigner profiles
  const bordIds = new Set<string>()
  const assignerIds = new Set<string>()
  for (const a of assignments || []) {
    if (a.bord_id) bordIds.add(a.bord_id)
    if (a.assigned_by) assignerIds.add(a.assigned_by)
  }

  const { data: bords } = bordIds.size > 0
    ? await supabaseAdmin.from('bords').select('id, title, organization_id').in('id', [...bordIds])
    : { data: [] }
  const bordMap = new Map((bords || []).map(b => [b.id, b]))

  const { data: assignerProfiles } = assignerIds.size > 0
    ? await supabaseAdmin.from('profiles').select('id, first_name, last_name').in('id', [...assignerIds])
    : { data: [] }
  const assignerMap = new Map((assignerProfiles || []).map(p => [p.id, p]))

  // Group by organization
  const tasksByOrg: Record<string, { organization: { _id: string; name: string }; tasks: any[] }> = {}
  const priorityOrder: Record<string, number> = { high: 3, normal: 2, low: 1 }

  for (const a of assignments || []) {
    const bord = bordMap.get(a.bord_id || '')
    const orgId = bord?.organization_id || a.organization_id
    if (!orgId) continue

    const org = orgMap.get(orgId)
    if (!org) continue

    if (!tasksByOrg[orgId]) {
      tasksByOrg[orgId] = { organization: org, tasks: [] }
    }

    const assigner = assignerMap.get(a.assigned_by || '')
    const employeeUpdates = (a.employee_updates || {}) as { columnId?: string | null; columnTitle?: string | null }
    const effectiveColumnId = employeeUpdates.columnId ?? a.column_id ?? null
    const effectiveColumnTitle = employeeUpdates.columnTitle ?? a.column_title ?? null

    tasksByOrg[orgId].tasks.push({
      _id: a.id,
      bordId: bord?.id || null,
      bordTitle: bord?.title || null,
      sourceType: a.source_type,
      sourceId: a.source_id,
      content: a.content,
      priority: a.priority,
      priorityOrder: priorityOrder[a.priority] || 2,
      dueDate: a.due_date || null,
      executionNote: a.execution_note,
      status: a.status,
      columnId: effectiveColumnId,
      columnTitle: effectiveColumnTitle,
      availableColumns: a.available_columns || [],
      publishedAt: a.published_at || null,
      completedAt: a.completed_at || null,
      createdAt: a.created_at,
      assigner: assigner ? { firstName: assigner.first_name, lastName: assigner.last_name } : undefined,
    })
  }

  // Sort tasks within each org
  for (const orgId of Object.keys(tasksByOrg)) {
    tasksByOrg[orgId].tasks.sort((a: any, b: any) => {
      if (a.status === 'completed' && b.status !== 'completed') return 1
      if (a.status !== 'completed' && b.status === 'completed') return -1
      if (b.priorityOrder !== a.priorityOrder) return b.priorityOrder - a.priorityOrder
      if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      if (a.dueDate && !b.dueDate) return -1
      if (!a.dueDate && b.dueDate) return 1
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    })
  }

  // Personal tasks (reminders)
  const { data: personalTasks } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('assigned_to', user.id)
    .eq('context_type', 'personal')
    .in('status', ['assigned', 'completed'])
    .eq('is_deleted', false)
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false })

  // Fetch assigner profiles for personal tasks
  const personalAssignerIds = new Set<string>()
  for (const a of personalTasks || []) {
    if (a.assigned_by) personalAssignerIds.add(a.assigned_by)
  }
  const { data: personalAssigners } = personalAssignerIds.size > 0
    ? await supabaseAdmin.from('profiles').select('id, first_name, last_name').in('id', [...personalAssignerIds])
    : { data: [] }
  const personalAssignerMap = new Map((personalAssigners || []).map(p => [p.id, p]))

  const personalItems = (personalTasks || []).map((a: any) => {
    const assigner = personalAssignerMap.get(a.assigned_by)
    const employeeUpdates = (a.employee_updates || {}) as { columnId?: string | null; columnTitle?: string | null }
    const effectiveColumnId = employeeUpdates.columnId ?? a.column_id ?? null
    const effectiveColumnTitle = employeeUpdates.columnTitle ?? a.column_title ?? null
    return {
      _id: a.id,
      bordId: null,
      bordTitle: null,
      sourceType: a.source_type,
      sourceId: a.source_id,
      content: a.content,
      priority: a.priority,
      priorityOrder: priorityOrder[a.priority] || 2,
      dueDate: a.due_date || null,
      executionNote: a.execution_note,
      status: a.status,
      columnId: effectiveColumnId,
      columnTitle: effectiveColumnTitle,
      availableColumns: a.available_columns || [],
      publishedAt: a.published_at || null,
      completedAt: a.completed_at || null,
      createdAt: a.created_at,
      contextType: 'personal',
      assigner: assigner ? { firstName: assigner.first_name, lastName: assigner.last_name } : undefined,
    }
  })

  return NextResponse.json({
    tasksByOrganization: Object.values(tasksByOrg),
    organizations: Array.from(orgMap.values()),
    personalTasks: personalItems,
    pagination: {
      offset,
      limit,
      hasMore: (assignments?.length || 0) === limit || (personalTasks?.length || 0) === limit,
    },
  })
}
