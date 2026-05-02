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

export async function POST(_req: Request, { params }: Params) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { id } = await params

  const { data: existing, error: fetchErr } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .select('id, conversation_id, status')
    .eq('id', id)
    .maybeSingle()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: 'Plan artifact not found' }, { status: 404 })
  }

  const isMember = await assertConversationMember(existing.conversation_id, user.id)
  if (!isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('ai_plan_artifacts')
    .update({ status: 'approved' } as never)
    .eq('id', id)
    .select('id, status, updated_at')
    .single()

  if (updateErr || !updated) {
    return NextResponse.json({ error: 'Failed to approve plan' }, { status: 500 })
  }

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    updatedAt: updated.updated_at,
  })
}
