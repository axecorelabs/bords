import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/api-helpers'
import { createTaskAssignment } from '@/lib/task-assignments'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/messages/conversations/[id]/assign-task
 * Body: { assignedTo: string, content: string }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return unauthorized()

  const { id: conversationId } = await params
  const body = await req.json().catch(() => ({}))
  const assignedTo = typeof body.assignedTo === 'string' ? body.assignedTo : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''

  if (!assignedTo || !content) {
    return badRequest('assignedTo and content are required')
  }

  const { data: senderMember } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!senderMember) return forbidden()

  const { data: assigneeMember } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', assignedTo)
    .maybeSingle()

  if (!assigneeMember) {
    return badRequest('assignee must be a member of this conversation')
  }

  const { data: conv } = await supabaseAdmin
    .from('conversations')
    .select('id, name, organization_id, workspace_id')
    .eq('id', conversationId)
    .maybeSingle()

  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  const sourceId = `chat:${conversationId}:${Date.now()}`
  const contextType = conv.organization_id ? 'organization' : 'personal'

  let assignment: any
  try {
    assignment = await createTaskAssignment({
      actorName: user.name,
      assignment: {
        bordId: null,
        workspaceId: conv.workspace_id ?? null,
        organizationId: conv.organization_id ?? null,
        contextType,
        sourceType: 'note',
        sourceId,
        content,
        assignedTo,
        assignedBy: user.id,
        priority: 'normal',
        status: 'assigned',
      },
      notify: true,
      notifyBestEffort: true,
      notificationMetadata: {
        conversationId,
        conversationName: conv.name,
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Failed to create assignment' }, { status: 500 })
  }

  // Create a message as "evidence" of the task assignment
  const { data: assigneeProfile } = await supabaseAdmin
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', assignedTo)
    .maybeSingle()

  const assigneeName = assigneeProfile
    ? `${assigneeProfile.first_name ?? ''} ${assigneeProfile.last_name ?? ''}`.trim() || assignedTo
    : assignedTo

  const evidenceMessage = `📋 Task assigned to ${assigneeName}: "${content}"`

  const { error: msgError } = await supabaseAdmin.from('messages').insert({
    conversation_id: conversationId,
    sender_id: user.id,
    content: evidenceMessage,
    is_system_message: true,
  })

  if (msgError) {
    // Non-critical: log but don't fail the request
    console.error('Failed to create evidence message:', msgError)
  }

  return NextResponse.json({
    ok: true,
    assignment: {
      id: assignment.id,
      assignedTo: assignment.assigned_to,
      content: assignment.content,
      createdAt: assignment.created_at,
    },
  }, { status: 201 })
}
