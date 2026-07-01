import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'

// GET /api/execution/tasks/[taskId]/activity — fetch audit log for a task
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { taskId } = await params

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .select('id, assigned_to, assigned_by, organization_id, content, execution_note, priority, due_date, description_type, checklist_items, skip_review, source_type')
    .eq('id', taskId)
    .maybeSingle()

  if (!assignment) return notFound('Task')

  // Must be assignee, assigner, or org owner/admin
  const isParticipant = assignment.assigned_to === user.id || assignment.assigned_by === user.id
  let canView = isParticipant

  if (!canView && assignment.organization_id) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', assignment.organization_id)
      .maybeSingle()

    if (org?.owner_id === user.id) {
      canView = true
    } else {
      const { data: membership } = await supabaseAdmin
        .from('employee_memberships')
        .select('role')
        .eq('organization_id', assignment.organization_id)
        .eq('user_id', user.id)
        .maybeSingle()
      canView = membership?.role === 'admin'
    }
  }

  if (!canView) return forbidden()

  const { data: log } = await supabaseAdmin
    .from('task_activity_log')
    .select('id, actor_id, actor_name, action, changes, created_at')
    .eq('task_assignment_id', taskId)
    .order('created_at', { ascending: false })
    .limit(50)

  return NextResponse.json({
    executionNote: assignment.execution_note ?? null,
    descriptionType: (assignment.description_type as 'text' | 'checklist') ?? 'text',
    checklistItems: (assignment.checklist_items as any[]) ?? [],
    priority: assignment.priority,
    dueDate: assignment.due_date ?? null,
    skipReview: (assignment as any).skip_review ?? false,
    sourceType: (assignment as any).source_type ?? null,
    activity: (log || []).map((e: any) => ({
      id: e.id,
      actorId: e.actor_id,
      actorName: e.actor_name,
      action: e.action,
      changes: e.changes ?? {},
      createdAt: e.created_at,
    })),
  })
}
