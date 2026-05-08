import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, forbidden } from '@/lib/api-helpers'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/messages/conversations/[id]/read
 * Upsert the current user's last-read position for a conversation.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await getAuthUser(req)
  if (!user) return unauthorized()

  const { id } = await params

  // Verify the caller is actually a member of this conversation
  const { data: member } = await supabaseAdmin
    .from('conversation_members')
    .select('role')
    .eq('conversation_id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!member) return forbidden()

  await supabaseAdmin
    .from('conversation_reads')
    .upsert({ conversation_id: id, user_id: user.id, last_read_at: new Date().toISOString() })

  return NextResponse.json({ ok: true })
}
