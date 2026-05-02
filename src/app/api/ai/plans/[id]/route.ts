import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

async function assertConversationMember(conversationId: string, userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}

export async function GET(_req: Request, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { id } = await params
  const { data: artifact, error } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .select('id, conversation_id, user_id, organization_id, title, goal, content, status, created_at, updated_at')
    .eq('id', id)
    .maybeSingle()

  if (error || !artifact) {
    return NextResponse.json({ error: 'Plan artifact not found' }, { status: 404 })
  }

  const isMember = await assertConversationMember(artifact.conversation_id, user.id)
  if (!isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  return NextResponse.json({
    id: artifact.id,
    conversationId: artifact.conversation_id,
    userId: artifact.user_id,
    organizationId: artifact.organization_id,
    title: artifact.title,
    goal: artifact.goal,
    content: artifact.content,
    status: artifact.status,
    createdAt: artifact.created_at,
    updatedAt: artifact.updated_at,
  })
}
