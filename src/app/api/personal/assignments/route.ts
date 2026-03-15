import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, badRequest, notFound } from '@/lib/api-helpers'

/**
 * GET /api/personal/assignments
 * List personal assignments (reminders).
 * - Self-assigned tasks
 * - Tasks assigned to the user by friends
 * - Tasks the user sent to friends
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const url = new URL(req.url)
  const filter = url.searchParams.get('filter') || 'all'

  let query = supabaseAdmin
    .from('task_assignments')
    .select('*')
    .eq('context_type', 'personal')
    .eq('is_deleted', false)

  if (filter === 'received') {
    query = query.eq('assigned_to', user.id)
  } else if (filter === 'sent') {
    query = query.eq('assigned_by', user.id)
  } else {
    query = query.or(`assigned_to.eq.${user.id},assigned_by.eq.${user.id}`)
  }

  const { data: tasks } = await query.order('created_at', { ascending: false })

  // Fetch profiles for populated fields
  const userIds = new Set<string>()
  for (const t of tasks || []) {
    if (t.assigned_to) userIds.add(t.assigned_to)
    if (t.assigned_by) userIds.add(t.assigned_by)
  }
  const { data: profiles } = userIds.size > 0
    ? await supabaseAdmin.from('profiles').select('id, first_name, last_name, email, image').in('id', [...userIds])
    : { data: [] }
  const profileMap = new Map((profiles || []).map(p => [p.id, p]))

  return NextResponse.json({
    tasks: (tasks || []).map(t => {
      const assignedTo = profileMap.get(t.assigned_to)
      const assignedBy = profileMap.get(t.assigned_by)
      return {
        _id: t.id,
        content: t.content,
        sourceType: t.source_type,
        sourceId: t.source_id,
        assignedTo: assignedTo ? {
          _id: assignedTo.id,
          firstName: assignedTo.first_name,
          lastName: assignedTo.last_name,
          email: assignedTo.email,
          image: assignedTo.image,
        } : t.assigned_to,
        assignedBy: assignedBy ? {
          _id: assignedBy.id,
          firstName: assignedBy.first_name,
          lastName: assignedBy.last_name,
          email: assignedBy.email,
          image: assignedBy.image,
        } : t.assigned_by,
        priority: t.priority,
        dueDate: t.due_date,
        executionNote: t.execution_note,
        status: t.status,
        completedAt: t.completed_at,
        createdAt: t.created_at,
        contextType: 'personal',
      }
    }),
  })
}

/**
 * POST /api/personal/assignments
 * Create a personal assignment (reminder).
 * Personal mode: IMMEDIATE write, no draft state, no publish flow.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const { sourceType, sourceId, content, assignedTo, dueDate, executionNote } = body

  if (!sourceType || !sourceId || !content) {
    return badRequest('sourceType, sourceId, and content are required')
  }

  // Find personal workspace
  const { data: personalWs } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id)
    .eq('type', 'personal')
    .maybeSingle()
  if (!personalWs) return notFound('Personal workspace')

  const recipientId = assignedTo || user.id
  const isSelfAssigned = recipientId === user.id

  // If assigning to someone else, verify they're a friend
  if (!isSelfAssigned) {
    const { data: friendship } = await supabaseAdmin
      .from('friends')
      .select('id')
      .eq('workspace_id', personalWs.id)
      .eq('friend_user_id', recipientId)
      .maybeSingle()
    if (!friendship) {
      return badRequest('You can only assign personal tasks to yourself or your friends')
    }
  }

  const now = new Date().toISOString()

  const { data: assignment } = await supabaseAdmin
    .from('task_assignments')
    .insert({
      bord_id: null,
      workspace_id: personalWs.id,
      context_type: 'personal',
      source_type: sourceType,
      source_id: sourceId,
      content,
      assigned_to: recipientId,
      assigned_by: user.id,
      priority: 'normal',
      due_date: dueDate || null,
      execution_note: executionNote || null,
      status: 'assigned',
      published_at: now,
    })
    .select()
    .single()

  // Create notification for recipient (if not self-assigned)
  if (!isSelfAssigned) {
    const { data: sender } = await supabaseAdmin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .maybeSingle()
    const senderName = sender ? `${sender.first_name} ${sender.last_name}`.trim() : 'Someone'

    await supabaseAdmin.from('notifications').insert({
      user_id: recipientId,
      type: 'task_assigned',
      title: 'New Personal Reminder',
      message: `${senderName} sent you a reminder: "${content.substring(0, 60)}${content.length > 60 ? '...' : ''}"`,
      metadata: {
        taskAssignmentId: assignment!.id,
        sourceType,
        sourceId,
      },
    })
  }

  return NextResponse.json({ assignment }, { status: 201 })
}
