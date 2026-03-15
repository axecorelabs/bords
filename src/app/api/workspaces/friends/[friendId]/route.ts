import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'

/**
 * DELETE /api/workspaces/friends/[friendId]
 * Remove a friend from the personal workspace.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ friendId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { friendId } = await params

  const { data: personalWs } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id)
    .eq('type', 'personal')
    .maybeSingle()
  if (!personalWs) return notFound('Personal workspace')

  const { data: friend } = await supabaseAdmin
    .from('friends')
    .select('id, owner_id, friend_user_id')
    .eq('id', friendId)
    .eq('workspace_id', personalWs.id)
    .maybeSingle()
  if (!friend) return notFound('Friend')
  if (friend.owner_id !== user.id) return forbidden()

  const friendUserId = friend.friend_user_id

  // Delete the friend record
  await supabaseAdmin.from('friends').delete().eq('id', friendId)

  // Delete reciprocal Friend record if it exists
  await supabaseAdmin
    .from('friends')
    .delete()
    .eq('owner_id', friendUserId)
    .eq('friend_user_id', user.id)

  // Notify the removed friend
  if (friendUserId !== user.id) {
    const { data: remover } = await supabaseAdmin
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', user.id)
      .maybeSingle()
    const removerName = remover
      ? `${remover.first_name || ''} ${remover.last_name || ''}`.trim() || 'Someone'
      : 'Someone'

    await supabaseAdmin.from('notifications').insert({
      user_id: friendUserId,
      type: 'friend_removed',
      title: 'Friend Removed',
      message: `${removerName} removed you from their friends list`,
      metadata: { senderName: removerName },
      is_read: false,
    })
  }

  return NextResponse.json({ success: true })
}
