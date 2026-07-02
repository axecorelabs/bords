import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'
import { apiLimiter, checkRateLimit } from '@/lib/rate-limit'

// GET /api/notifications — get notifications for current user
export async function GET() {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const rateLimitRes = await checkRateLimit(apiLimiter, user.id)
  if (rateLimitRes) return rateLimitRes

  const { data: notifications } = await supabaseAdmin
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  const items = notifications || []

  return NextResponse.json({
    notifications: items.map((n: any) => ({
      _id: n.id,
      userId: n.user_id,
      type: n.type,
      title: n.title,
      message: n.message,
      metadata: n.metadata,
      isRead: n.is_read,
      createdAt: n.created_at,
    })),
    unreadCount: items.filter((n: any) => !n.is_read).length,
  })
}

// PUT /api/notifications — mark notifications as read
export async function PUT(req: NextRequest) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const body = await req.json()
  const { notificationIds, markAllRead } = body

  if (markAllRead) {
    await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', user.id)
      .eq('is_read', false)
  } else if (notificationIds?.length) {
    await supabaseAdmin
      .from('notifications')
      .update({ is_read: true })
      .in('id', notificationIds)
      .eq('user_id', user.id)
  }

  return NextResponse.json({ success: true })
}
