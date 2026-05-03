import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'
import { BORDS_AI_PROFILE_ID } from '@/app/api/ai/conversation/ensure/route'

/**
 * POST /api/ai/conversation/new
 * Creates a brand-new AI conversation session for the current user (+ optional org).
 * Unlike /ensure, this always creates a new thread.
 */
export async function POST(req: Request) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await req.json().catch(() => ({}))
  const organizationId: string | null = body.organizationId ?? null
  const title = typeof body.title === 'string' ? body.title.trim() : ''

  const { data: conv, error: convErr } = await supabaseAdmin
    .from('conversations')
    .insert({
      type: 'dm',
      name: title || 'New chat',
      description: null,
      organization_id: organizationId,
      workspace_id: null,
      created_by: user.id,
      is_ai_conversation: true,
    })
    .select('id, type, name, description, avatar_url, organization_id, workspace_id, created_by, created_at, updated_at, is_ai_conversation')
    .single()

  if (convErr || !conv) {
    return NextResponse.json({ error: convErr?.message ?? 'Failed to create AI conversation' }, { status: 500 })
  }

  const { error: membersErr } = await supabaseAdmin
    .from('conversation_members')
    .insert([
      { conversation_id: conv.id, user_id: user.id, role: 'member' },
      { conversation_id: conv.id, user_id: BORDS_AI_PROFILE_ID, role: 'member' },
    ])

  if (membersErr) {
    await supabaseAdmin.from('conversations').delete().eq('id', conv.id)
    return NextResponse.json({ error: membersErr.message }, { status: 500 })
  }

  await supabaseAdmin.from('messages').insert({
    conversation_id: conv.id,
    sender_id: BORDS_AI_PROFILE_ID,
    content: "New chat started. Tell me what you want to work on, and I'll keep this thread focused.",
    is_system_message: true,
    is_ai_message: true,
  })

  return NextResponse.json({
    id: conv.id,
    type: conv.type,
    name: conv.name,
    description: conv.description,
    avatarUrl: conv.avatar_url,
    organizationId: conv.organization_id,
    workspaceId: conv.workspace_id,
    createdBy: conv.created_by,
    createdAt: conv.created_at,
    updatedAt: conv.updated_at,
    isAiConversation: conv.is_ai_conversation,
  })
}
