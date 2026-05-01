import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/api-helpers'

type Params = { params: Promise<{ orgId: string }> }

/**
 * GET /api/organizations/[orgId]/assigned-tasks?userId=...
 * Owner/admin only. Returns all tasks assigned to the specified user in this org,
 * including board-linked and chat-created assignments.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { orgId } = await params
  const targetUserId = req.nextUrl.searchParams.get('userId')?.trim()
  if (!targetUserId) return badRequest('userId is required')

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('id, owner_id')
    .eq('id', orgId)
    .maybeSingle()

  if (!org) return NextResponse.json({ error: 'Organization not found' }, { status: 404 })

  const isOwner = org.owner_id === user.id
  let isAdmin = false

  if (!isOwner) {
    const { data: membership } = await supabaseAdmin
      .from('employee_memberships')
      .select('id, role')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()

    isAdmin = membership?.role === 'admin'
  }

  if (!isOwner && !isAdmin) return forbidden()

  const { data: orgBords } = await supabaseAdmin
    .from('bords')
    .select('id')
    .eq('organization_id', orgId)

  const bordIds = (orgBords || []).map((b: any) => b.id)
  const orgScopeFilter = bordIds.length > 0
    ? `organization_id.eq.${orgId},bord_id.in.(${bordIds.join(',')})`
    : `organization_id.eq.${orgId}`

  const { data, error } = await supabaseAdmin
    .from('task_assignments')
    .select('id, content, status, priority, source_type, due_date, created_at, completed_at, bords(title)')
    .or(orgScopeFilter)
    .eq('assigned_to', targetUserId)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })
    .limit(300)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const toLabel = (sourceType: string, boardTitle: string | null) => {
    if (sourceType === 'note') return boardTitle ? 'Board Note Assignment' : 'Chat Assignment'
    if (sourceType === 'checklist_item') return 'Checklist Assignment'
    if (sourceType === 'kanban_task') return 'Kanban Assignment'
    if (sourceType === 'reminder_item') return 'Reminder Assignment'
    return sourceType
  }

  return NextResponse.json({
    tasks: (data || []).map((row: any) => {
      const boardTitle = row.bords?.title || null
      return {
        id: row.id,
        content: row.content,
        status: row.status,
        priority: row.priority,
        sourceType: row.source_type,
        sourceLabel: toLabel(row.source_type, boardTitle),
        boardTitle,
        dueDate: row.due_date,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      }
    }),
  })
}
