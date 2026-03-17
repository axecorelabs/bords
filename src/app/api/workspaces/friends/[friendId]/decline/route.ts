import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, badRequest } from '@/lib/api-helpers'

/**
 * POST /api/workspaces/friends/[friendId]/decline
 * Decline a friend request. The authenticated user must be the friend_user_id
 * (the person who was invited). Deletes the Friend record entirely.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ friendId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { friendId } = await params

  const { data: friendRecord } = await supabaseAdmin
    .from('friends')
    .select('*')
    .eq('id', friendId)
    .maybeSingle()

  if (!friendRecord) return notFound('Friend request')

  // Only the invited user can decline
  if (friendRecord.friend_user_id !== user.id) {
    return badRequest('You cannot decline this request')
  }

  if (friendRecord.status === 'accepted') {
    return badRequest('Already accepted — use remove instead')
  }

  // Delete the pending record
  await supabaseAdmin.from('friends').delete().eq('id', friendId)

  // Mark any related friend_request notifications as read
  const { data: notifs } = await supabaseAdmin
    .from('notifications')
    .select('id, metadata')
    .eq('user_id', user.id)
    .eq('type', 'friend_request')
    .eq('is_read', false)

  for (const n of notifs || []) {
    const meta = n.metadata as any
    if (meta?.friendId === friendId) {
      await supabaseAdmin
        .from('notifications')
        .update({ is_read: true })
        .eq('id', n.id)
    }
  }

  return NextResponse.json({ success: true, message: 'Friend request declined' })
}
