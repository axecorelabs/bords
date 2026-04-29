import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'

// GET /api/execution/tasks/org/[orgId] — get ALL tasks assigned within an organization
// Only accessible to org members; returns all org tasks (not just the caller's)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { orgId } = await params

  // Verify user is org owner or member
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('owner_id')
    .eq('id', orgId)
    .maybeSingle()

  const isOwner = org?.owner_id === user.id
  if (!isOwner) {
    const { data: membership } = await supabaseAdmin
      .from('employee_memberships')
      .select('id')
      .eq('user_id', user.id)
      .eq('organization_id', orgId)
      .maybeSingle()

    if (!membership) {
      return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 })
    }
  }

  // Get all bords in this org
  const { data: orgBords } = await supabaseAdmin
    .from('bords')
    .select('id, title')
    .eq('organization_id', orgId)

  const bordIds = (orgBords || []).map(b => b.id)
  const bordMap = new Map((orgBords || []).map(b => [b.id, b]))

  if (bordIds.length === 0) {
    return NextResponse.json({ tasks: [] })
  }

  // All assignments for bords in this org
  const { data: assignments } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .in('bord_id', bordIds)
    .in('status', ['assigned', 'completed'])
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  // Collect profile IDs (assigners + assignees)
  const profileIds = new Set<string>()
  for (const a of assignments || []) {
    if (a.assigned_by) profileIds.add(a.assigned_by)
    if (a.assigned_to) profileIds.add(a.assigned_to)
  }

  const { data: profiles } = profileIds.size > 0
    ? await supabaseAdmin.from('profiles').select('id, first_name, last_name, email').in('id', [...profileIds])
    : { data: [] }
  const profileMap = new Map((profiles || []).map(p => [p.id, p]))

  const priorityOrder: Record<string, number> = { high: 3, normal: 2, low: 1 }

  const tasks = (assignments || []).map((a: any) => {
    const bord = bordMap.get(a.bord_id || '')
    const assigner = profileMap.get(a.assigned_by || '')
    const assignee = profileMap.get(a.assigned_to || '')

    return {
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
      columnId: a.column_id || null,
      columnTitle: a.column_title || null,
      availableColumns: a.available_columns || [],
      completedAt: a.completed_at || null,
      createdAt: a.created_at,
      assigner: assigner
        ? { firstName: assigner.first_name, lastName: assigner.last_name }
        : undefined,
      assignee: assignee
        ? { firstName: assignee.first_name, lastName: assignee.last_name, email: assignee.email }
        : undefined,
    }
  })

  // Sort: active first, then by priority, then by due date
  tasks.sort((a: any, b: any) => {
    if (a.status === 'completed' && b.status !== 'completed') return 1
    if (a.status !== 'completed' && b.status === 'completed') return -1
    if (b.priorityOrder !== a.priorityOrder) return b.priorityOrder - a.priorityOrder
    if (a.dueDate && b.dueDate) return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    if (a.dueDate && !b.dueDate) return -1
    if (!a.dueDate && b.dueDate) return 1
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  })

  return NextResponse.json({ tasks })
}
