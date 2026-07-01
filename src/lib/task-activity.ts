import { render } from '@react-email/components'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import TaskAssignedEmail from '@/emails/TaskAssignedEmail'

export type TaskActivityAction = 'assigned' | 'edited' | 'completed' | 'reopened' | 'deleted' | 'submitted_for_review'

export interface TaskActivityChanges {
  content?: { before: string; after: string }
  dueDate?: { before: string | null; after: string | null }
  priority?: { before: string; after: string }
  executionNote?: { before: string | null; after: string | null }
}

export async function logTaskActivity(params: {
  taskAssignmentId: string
  organizationId: string | null
  actorId: string
  actorName: string
  action: TaskActivityAction
  changes?: TaskActivityChanges
}): Promise<void> {
  const { taskAssignmentId, organizationId, actorId, actorName, action, changes } = params
  await supabaseAdmin.from('task_activity_log').insert({
    task_assignment_id: taskAssignmentId,
    organization_id: organizationId ?? null,
    actor_id: actorId,
    actor_name: actorName,
    action,
    changes: changes ?? {},
  })
}

export async function notifyAndEmailTaskEvent(params: {
  taskAssignmentId: string
  assignedTo: string
  assignedBy: string
  actorId: string
  actorName: string
  action: 'edited' | 'deleted'
  taskContent: string
  organizationId: string | null
  orgName?: string
}): Promise<void> {
  const {
    taskAssignmentId, assignedTo, assignedBy, actorId, actorName,
    action, taskContent, organizationId, orgName,
  } = params

  const notifType = action === 'edited' ? 'task_edited' : 'task_deleted'
  const notifTitle = action === 'edited' ? 'Task Updated' : 'Task Removed'

  // Notify the other party: assigner acts → notify assignee; assignee acts → notify assigner
  const notifyUserId = actorId === assignedBy ? assignedTo : assignedBy
  const actorIsAssigner = actorId === assignedBy
  const notifMessage = action === 'edited'
    ? actorIsAssigner
      ? `${actorName} updated a task assigned to you: "${taskContent.substring(0, 80)}"`
      : `${actorName} updated a task they were assigned: "${taskContent.substring(0, 80)}"`
    : actorIsAssigner
      ? `${actorName} removed a task assigned to you: "${taskContent.substring(0, 80)}"`
      : `${actorName} removed a task they were assigned: "${taskContent.substring(0, 80)}"`

  // Insert in-app notification (fire-and-forget)
  supabaseAdmin.from('notifications').insert({
    user_id: notifyUserId,
    type: notifType,
    title: notifTitle,
    message: notifMessage,
    metadata: { taskAssignmentId, organizationId, actorId, actorName },
    is_read: false,
  }).then(() => {}, () => {})

  // Also notify org owners/admins if this is an org task and actor is the assignee
  if (organizationId && actorId === assignedTo) {
    supabaseAdmin
      .from('organizations')
      .select('owner_id')
      .eq('id', organizationId)
      .maybeSingle()
      .then(({ data: org }) => {
        if (!org) return
        supabaseAdmin
          .from('employee_memberships')
          .select('user_id')
          .eq('organization_id', organizationId)
          .eq('role', 'admin')
          .then(({ data: admins }) => {
            const recipients = new Set<string>()
            if (org.owner_id !== actorId) recipients.add(org.owner_id)
            for (const a of admins || []) {
              if (a.user_id !== actorId) recipients.add(a.user_id)
            }
            const rows = Array.from(recipients).map((uid) => ({
              user_id: uid,
              type: notifType,
              title: notifTitle,
              message: notifMessage,
              metadata: { taskAssignmentId, organizationId, actorId, actorName },
              is_read: false,
            }))
            if (rows.length) supabaseAdmin.from('notifications').insert(rows).then(() => {}, () => {})
          })
      })
  }

  // Send email to the notified user (fire-and-forget)
  ;(async () => {
    try {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('email, first_name, last_name')
        .eq('id', notifyUserId)
        .maybeSingle()
      if (!profile?.email) return

      const assigneeName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email
      const emailType = action === 'edited' ? 'updated' : 'removed'
      const html = await render(
        TaskAssignedEmail({
          assigneeName,
          bordTitle: orgName || 'Your Organization',
          orgName,
          tasks: [{ content: taskContent, type: emailType as 'updated' | 'removed' }],
          inboxUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://bords.app'}/dashboard`,
        })
      )
      const subject = action === 'edited'
        ? `Task updated: "${taskContent.substring(0, 60)}"`
        : `Task removed: "${taskContent.substring(0, 60)}"`
      await sendEmail({ to: profile.email, subject, html })
    } catch {
      // silent — email is best-effort
    }
  })()
}
