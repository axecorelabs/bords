import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, badRequest } from '@/lib/api-helpers'

/**
 * POST /api/workspaces/friends/[friendId]/accept
 * Accept a friend request. The authenticated user must be the friend_user_id.
 * On acceptance:
 * 1. Set the Friend record status to 'accepted'
 * 2. Create a reciprocal Friend record (so both users see each other)
 * 3. Send a 'friend_accepted' notification to the requester
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

  // Only the invited user can accept
  if (friendRecord.friend_user_id !== user.id) {
    return badRequest('You cannot accept this request')
  }

  if (friendRecord.status === 'accepted') {
    return badRequest('Already accepted')
  }

  // 1. Accept the friend record
  await supabaseAdmin
    .from('friends')
    .update({ status: 'accepted' })
    .eq('id', friendId)

  // 2. Create a reciprocal Friend record (accepter → requester)
  const { data: accepterWs } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id)
    .eq('type', 'personal')
    .maybeSingle()

  if (accepterWs) {
    const { data: requesterUser } = await supabaseAdmin
      .from('profiles')
      .select('id, email')
      .eq('id', friendRecord.owner_id)
      .maybeSingle()

    const { data: existing } = await supabaseAdmin
      .from('friends')
      .select('id')
      .eq('workspace_id', accepterWs.id)
      .eq('friend_user_id', friendRecord.owner_id)
      .maybeSingle()

    if (!existing && requesterUser) {
      await supabaseAdmin.from('friends').insert({
        workspace_id: accepterWs.id,
        owner_id: user.id,
        friend_user_id: friendRecord.owner_id,
        email: requesterUser.email,
        status: 'accepted',
      })
    }
  }

  // 3. Send a 'friend_accepted' notification to the requester
  const { data: accepterProfile } = await supabaseAdmin
    .from('profiles')
    .select('first_name, last_name, email')
    .eq('id', user.id)
    .maybeSingle()

  const accepterName = accepterProfile
    ? `${accepterProfile.first_name || ''} ${accepterProfile.last_name || ''}`.trim() || accepterProfile.email
    : 'Someone'

  await supabaseAdmin.from('notifications').insert({
    user_id: friendRecord.owner_id,
    type: 'friend_accepted',
    title: 'Friend Request Accepted',
    message: `${accepterName} accepted your friend request`,
    metadata: {
      friendId: friendRecord.id,
      senderName: accepterName,
    },
    is_read: false,
  })

  return NextResponse.json({ success: true, message: 'Friend request accepted' })
}
