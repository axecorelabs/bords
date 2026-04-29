import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden, badRequest } from '@/lib/api-helpers'
import { render } from '@react-email/components'
import { sendEmail } from '@/lib/email'
import TaskAssignedEmail from '@/emails/TaskAssignedEmail'
import { actionLimiter, checkRateLimit } from '@/lib/rate-limit'

// POST /api/bords/[bordId]/publish — publish all draft assignments
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bordId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  // Rate limit by user ID
  const rateLimited = await checkRateLimit(actionLimiter, user.id)
  if (rateLimited) return rateLimited

  const { bordId } = await params

  const { data: bord } = await supabaseAdmin
    .from('bords')
    .select('id, owner_id, organization_id, title')
    .eq('id', bordId)
    .maybeSingle()

  if (!bord) return notFound('Bord')
  if (bord.owner_id !== user.id) return forbidden()

  // Fetch organization name for notification context
  let orgName = ''
  if (bord.organization_id) {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('name')
      .eq('id', bord.organization_id)
      .maybeSingle()
    orgName = org?.name || ''
  }

  // Get all draft assignments for this bord
  const { data: draftAssignments } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('bord_id', bordId)
    .eq('status', 'draft')
    .eq('is_deleted', false)

  // Get soft-deleted assignments that were previously published (unassignments)
  const { data: unassigned } = await supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('bord_id', bordId)
    .eq('is_deleted', true)
    .not('published_at', 'is', null)

  const drafts = draftAssignments || []
  const unassignedList = unassigned || []

  if (drafts.length === 0 && unassignedList.length === 0) {
    return badRequest('No unpublished changes to publish')
  }

  // Warn if > 30 at once
  const totalTasks = drafts.length + unassignedList.length
  if (totalTasks > 30) {
    const { force } = await req.json().catch(() => ({ force: false }))
    if (!force) {
      return NextResponse.json({
        warning: `Publishing ${totalTasks} tasks at once. Send with force: true to proceed.`,
        count: totalTasks,
      }, { status: 422 })
    }
  }

  let newAssignments = 0
  let reassignments = 0
  const now = new Date().toISOString()
  const notifications: any[] = []

  for (const assignment of drafts) {
    if (assignment.published_at) {
      reassignments++
      notifications.push({
        user_id: assignment.assigned_to,
        type: 'task_reassigned',
        title: 'Task Updated',
        message: `A task in "${bord.title}" has been updated: "${assignment.content.substring(0, 80)}"`,
        metadata: {
          bordId: bord.id,
          taskAssignmentId: assignment.id,
          bordTitle: bord.title,
          organizationId: bord.organization_id || '',
          organizationName: orgName,
        },
      })
    } else {
      newAssignments++
      notifications.push({
        user_id: assignment.assigned_to,
        type: 'task_assigned',
        title: 'New Task Assigned',
        message: `You've been assigned a task in "${bord.title}": "${assignment.content.substring(0, 80)}"`,
        metadata: {
          bordId: bord.id,
          taskAssignmentId: assignment.id,
          bordTitle: bord.title,
          organizationId: bord.organization_id || '',
          organizationName: orgName,
        },
      })
    }

    await supabaseAdmin
      .from('task_assignments')
      .update({ status: 'assigned', published_at: now })
      .eq('id', assignment.id)
  }

  // Handle unassignments
  for (const assignment of unassignedList) {
    notifications.push({
      user_id: assignment.assigned_to,
      type: 'task_unassigned',
      title: 'Task Removed',
      message: `A task in "${bord.title}" has been removed: "${assignment.content.substring(0, 80)}"`,
      metadata: {
        bordId: bord.id,
        taskAssignmentId: assignment.id,
        bordTitle: bord.title,
        organizationId: bord.organization_id || '',
        organizationName: orgName,
      },
    })
    // Permanently delete soft-deleted ones after publishing
    await supabaseAdmin.from('task_assignments').delete().eq('id', assignment.id)
  }

  // Create notifications
  if (notifications.length > 0) {
    await supabaseAdmin.from('notifications').insert(notifications)
  }

  // Send email notifications grouped by assignee
  try {
    const tasksByUser = new Map<string, { content: string; type: 'new' | 'updated' | 'removed' }[]>()
    for (const n of notifications) {
      const tasks = tasksByUser.get(n.user_id) || []
      const type = n.type === 'task_assigned' ? 'new' : n.type === 'task_reassigned' ? 'updated' : 'removed'
      tasks.push({ content: n.message.split(': "')[1]?.replace(/"$/, '') || n.message, type })
      tasksByUser.set(n.user_id, tasks)
    }

    const userIds = [...tasksByUser.keys()]
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id, email, first_name')
        .in('id', userIds)

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://bords.app'

      for (const profile of profiles || []) {
        const tasks = tasksByUser.get(profile.id)
        if (!tasks || !profile.email) continue

        const html = await render(
          TaskAssignedEmail({
            assigneeName: profile.first_name || 'there',
            bordTitle: bord.title,
            orgName,
            tasks,
            inboxUrl: `${baseUrl}/dashboard`,
          })
        )

        sendEmail({
          to: profile.email,
          subject: `New tasks assigned to you in "${bord.title}"`,
          html,
        }).catch(err => console.error('Failed to send task email:', err))
      }
    }
  } catch (err) {
    console.error('Task email sending error:', err)
  }

  // Get latest snapshot version
  const { data: lastSnapshot } = await supabaseAdmin
    .from('publish_snapshots')
    .select('version_number')
    .eq('bord_id', bordId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = (lastSnapshot?.version_number || 0) + 1

  // Create snapshot
  const { data: snapshot } = await supabaseAdmin
    .from('publish_snapshots')
    .insert({
      bord_id: bordId,
      version_number: nextVersion,
      published_by: user.id,
      new_assignments: newAssignments,
      reassignments,
      unassignments: unassignedList.length,
      published_at: now,
    })
    .select()
    .single()

  // Update bord
  await supabaseAdmin
    .from('bords')
    .update({ last_published_at: now })
    .eq('id', bordId)

  // Reset change tracker
  await supabaseAdmin
    .from('unpublished_change_tracker')
    .upsert(
      { bord_id: bordId, change_count: 0, last_modified_at: now },
      { onConflict: 'bord_id' }
    )

  return NextResponse.json({
    publish: {
      snapshotId: snapshot?.id,
      versionNumber: nextVersion,
      newAssignments,
      reassignments,
      unassignments: unassignedList.length,
      totalDeployed: newAssignments + reassignments,
    },
  })
}
