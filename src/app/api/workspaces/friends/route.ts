import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, badRequest, notFound } from '@/lib/api-helpers'

/**
 * GET /api/workspaces/friends
 * List all friends in the user's personal workspace.
 */
export async function GET() {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { data: personalWs } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id)
    .eq('type', 'personal')
    .maybeSingle()

  if (!personalWs) {
    return NextResponse.json({ friends: [] })
  }

  const { data: friends } = await supabaseAdmin
    .from('friends')
    .select('id, friend_user_id, email, nickname, status, created_at')
    .eq('workspace_id', personalWs.id)
    .order('created_at', { ascending: false })

  // Fetch profile info for each friend
  const friendUserIds = (friends || []).map(f => f.friend_user_id).filter(Boolean)
  const { data: profiles } = friendUserIds.length > 0
    ? await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, email, image')
        .in('id', friendUserIds)
    : { data: [] }

  const profileMap = new Map((profiles || []).map(p => [p.id, p]))

  return NextResponse.json({
    friends: (friends || []).map(f => {
      const profile = profileMap.get(f.friend_user_id)
      return {
        _id: f.id,
        userId: f.friend_user_id,
        email: f.email,
        nickname: f.nickname,
        firstName: profile?.first_name || '',
        lastName: profile?.last_name || '',
        image: profile?.image || '',
        status: f.status || 'accepted',
      }
    }),
  })
}

/**
 * POST /api/workspaces/friends
 * Add a friend by email to the personal workspace.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { email, nickname } = await req.json()
  if (!email?.trim()) return badRequest('Email is required')

  const { data: personalWs } = await supabaseAdmin
    .from('workspaces')
    .select('id')
    .eq('owner_id', user.id)
    .eq('type', 'personal')
    .maybeSingle()
  if (!personalWs) return notFound('Personal workspace')

  // Find the friend user by email
  const normalizedEmail = email.toLowerCase().trim()
  const { data: friendProfile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, first_name, last_name, image')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (!friendProfile) {
    return badRequest('No user found with that email')
  }

  if (friendProfile.id === user.id) {
    return badRequest('You cannot add yourself as a friend')
  }

  // Check if already a friend
  const { data: existing } = await supabaseAdmin
    .from('friends')
    .select('id')
    .eq('workspace_id', personalWs.id)
    .eq('friend_user_id', friendProfile.id)
    .maybeSingle()
  if (existing) {
    return badRequest('This person is already your friend')
  }

  const { data: friend } = await supabaseAdmin
    .from('friends')
    .insert({
      workspace_id: personalWs.id,
      owner_id: user.id,
      friend_user_id: friendProfile.id,
      email: friendProfile.email,
      nickname: nickname?.trim() || null,
      status: 'pending',
    })
    .select()
    .single()

  // Get sender name
  const { data: senderProfile } = await supabaseAdmin
    .from('profiles')
    .select('first_name, last_name, email')
    .eq('id', user.id)
    .maybeSingle()
  const senderName = senderProfile
    ? `${senderProfile.first_name || ''} ${senderProfile.last_name || ''}`.trim() || senderProfile.email
    : 'Someone'

  await supabaseAdmin.from('notifications').insert({
    user_id: friendProfile.id,
    type: 'friend_request',
    title: 'Friend Request',
    message: `${senderName} wants to add you as a friend`,
    metadata: {
      friendId: friend!.id,
      senderName,
    },
    is_read: false,
  })

  return NextResponse.json({
    friend: {
      _id: friend!.id,
      userId: friendProfile.id,
      email: friendProfile.email,
      nickname: friend!.nickname,
      firstName: friendProfile.first_name,
      lastName: friendProfile.last_name,
      image: friendProfile.image,
      status: friend!.status,
    },
  }, { status: 201 })
}
