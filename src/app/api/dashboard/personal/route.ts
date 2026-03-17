import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized } from '@/lib/api-helpers'

/**
 * GET /api/dashboard/personal
 *
 * Aggregated dashboard data for the user's personal workspace.
 * Returns: profile, friends, boards, personal assignment stats, KPIs, charts, activity.
 */
export async function GET() {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  // Fetch user profile
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('id, email, first_name, last_name, image')
    .eq('id', user.id)
    .maybeSingle()

  // Fetch personal workspace
  const { data: personalWs } = await supabaseAdmin
    .from('workspaces')
    .select('id, created_at')
    .eq('owner_id', user.id)
    .eq('type', 'personal')
    .maybeSingle()

  // Parallel fetch
  const [
    friendsRes,
    bordsRes,
    assignmentsRes,
    notificationsRes,
  ] = await Promise.all([
    // Friends
    personalWs
      ? supabaseAdmin
          .from('friends')
          .select('id, friend_user_id, email, nickname, status, created_at')
          .eq('workspace_id', personalWs.id)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
    // Personal boards (boards not linked to any org, owned by user)
    supabaseAdmin
      .from('board_documents')
      .select('id, local_board_id, title, context_type, created_at, updated_at')
      .eq('owner_id', user.id)
      .eq('context_type', 'personal')
      .order('updated_at', { ascending: false }),
    // Personal assignments (assigned to or by the user in personal context)
    supabaseAdmin
      .from('task_assignments')
      .select('id, status, priority, assigned_to, assigned_by, source_type, due_date, created_at, published_at, completed_at, is_deleted, content')
      .eq('context_type', 'personal')
      .eq('is_deleted', false)
      .or(`assigned_to.eq.${user.id},assigned_by.eq.${user.id}`),
    // Recent notifications (personal context)
    supabaseAdmin
      .from('notifications')
      .select('id, type, title, message, metadata, is_read, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const friends = friendsRes.data || []
  const boards = bordsRes.data || []
  const allAssignments = assignmentsRes.data || []
  const notifications = notificationsRes.data || []

  // Fetch friend profiles
  const friendUserIds = friends.map((f: any) => f.friend_user_id).filter(Boolean)
  const { data: friendProfiles } = friendUserIds.length > 0
    ? await supabaseAdmin
        .from('profiles')
        .select('id, first_name, last_name, email, image')
        .in('id', friendUserIds)
    : { data: [] }
  const friendProfileMap = new Map((friendProfiles || []).map((p: any) => [p.id, p]))

  // Filter personal notifications
  const personalNotifications = notifications.filter((n: any) =>
    !n.metadata?.organizationId
  )

  // Compute assignment stats (tasks assigned to user)
  const myAssignments = allAssignments.filter((a: any) => a.assigned_to === user.id)
  const nowMs = Date.now()

  const stats = {
    totalAssignments: myAssignments.length,
    draft: myAssignments.filter((a: any) => a.status === 'draft').length,
    assigned: myAssignments.filter((a: any) => a.status === 'assigned').length,
    completed: myAssignments.filter((a: any) => a.status === 'completed').length,
    highPriority: myAssignments.filter((a: any) => a.priority === 'high').length,
    overdue: myAssignments.filter((a: any) => {
      if (a.status === 'completed' || !a.due_date) return false
      return new Date(a.due_date).getTime() < nowMs
    }).length,
  }

  // Tasks sent to friends
  const sentTasks = allAssignments.filter((a: any) => a.assigned_by === user.id && a.assigned_to !== user.id)
  const sentStats = {
    total: sentTasks.length,
    assigned: sentTasks.filter((a: any) => a.status === 'assigned').length,
    completed: sentTasks.filter((a: any) => a.status === 'completed').length,
  }

  // Chart data
  const priorityDistribution = {
    low: myAssignments.filter((a: any) => a.priority === 'low').length,
    normal: myAssignments.filter((a: any) => a.priority === 'normal').length,
    high: myAssignments.filter((a: any) => a.priority === 'high').length,
  }

  const sourceTypeDistribution = {
    note: myAssignments.filter((a: any) => a.source_type === 'note').length,
    checklist_item: myAssignments.filter((a: any) => a.source_type === 'checklist_item').length,
    kanban_task: myAssignments.filter((a: any) => a.source_type === 'kanban_task').length,
  }

  // Timeline (last 8 weeks)
  const now = new Date()
  const timeline: { week: string; created: number; completed: number }[] = []
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now)
    weekStart.setDate(weekStart.getDate() - i * 7)
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`
    const created = myAssignments.filter((a: any) => {
      const d = new Date(a.created_at)
      return d >= weekStart && d < weekEnd
    }).length
    const completed = myAssignments.filter((a: any) => {
      if (!a.completed_at) return false
      const d = new Date(a.completed_at)
      return d >= weekStart && d < weekEnd
    }).length
    timeline.push({ week: label, created, completed })
  }

  // KPIs
  const completionRate = myAssignments.length > 0
    ? Math.round((stats.completed / myAssignments.length) * 100)
    : 0

  const completedWithTimes = myAssignments.filter(
    (a: any) => a.status === 'completed' && a.completed_at && a.published_at
  )
  const avgCompletionHours = completedWithTimes.length > 0
    ? completedWithTimes.reduce((sum: number, a: any) => {
        return sum + (new Date(a.completed_at).getTime() - new Date(a.published_at).getTime())
      }, 0) / completedWithTimes.length / (1000 * 60 * 60)
    : null

  const completedWithDue = myAssignments.filter(
    (a: any) => a.status === 'completed' && a.due_date && a.completed_at
  )
  const onTimeCount = completedWithDue.filter(
    (a: any) => new Date(a.completed_at) <= new Date(a.due_date)
  ).length
  const onTimeRate = completedWithDue.length > 0
    ? Math.round((onTimeCount / completedWithDue.length) * 100)
    : null

  const thisWeekStart = new Date(now)
  thisWeekStart.setDate(thisWeekStart.getDate() - 7)
  thisWeekStart.setHours(0, 0, 0, 0)
  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)

  const completedThisWeek = myAssignments.filter((a: any) => {
    if (!a.completed_at) return false
    const d = new Date(a.completed_at).getTime()
    return d >= thisWeekStart.getTime() && d < nowMs
  }).length

  const completedLastWeek = myAssignments.filter((a: any) => {
    if (!a.completed_at) return false
    const d = new Date(a.completed_at).getTime()
    return d >= lastWeekStart.getTime() && d < thisWeekStart.getTime()
  }).length

  const velocityTrend = completedLastWeek > 0
    ? Math.round(((completedThisWeek - completedLastWeek) / completedLastWeek) * 100)
    : completedThisWeek > 0 ? 100 : 0

  // Upcoming / urgent tasks — active tasks sorted by priority + due date
  const priorityOrder: Record<string, number> = { high: 0, normal: 1, low: 2 }
  const activeTasks = myAssignments.filter((a: any) => a.status === 'assigned' || a.status === 'draft')
  const upcomingTasks = [...activeTasks]
    .sort((a: any, b: any) => {
      const pa = priorityOrder[a.priority] ?? 1
      const pb = priorityOrder[b.priority] ?? 1
      if (pa !== pb) return pa - pb
      // Tasks with due dates first, earliest first
      if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      if (a.due_date) return -1
      if (b.due_date) return 1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
    .slice(0, 5)

  return NextResponse.json({
    profile: {
      _id: user.id,
      email: profile?.email || user.email,
      firstName: profile?.first_name || '',
      lastName: profile?.last_name || '',
      image: profile?.image || null,
    },
    createdAt: personalWs?.created_at || null,
    friends: friends.map((f: any) => {
      const fp = friendProfileMap.get(f.friend_user_id)
      return {
        _id: f.id,
        userId: f.friend_user_id,
        email: fp?.email || f.email,
        nickname: f.nickname || null,
        firstName: fp?.first_name || '',
        lastName: fp?.last_name || '',
        image: fp?.image || null,
        status: f.status,
        createdAt: f.created_at,
      }
    }),
    boards: boards.map((b: any) => ({
      _id: b.id,
      title: b.title,
      localBoardId: b.local_board_id,
      createdAt: b.created_at,
      updatedAt: b.updated_at,
    })),
    stats,
    sentStats,
    recentActivity: personalNotifications.slice(0, 15).map((n: any) => ({
      _id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      isRead: n.is_read,
      createdAt: n.created_at,
    })),
    charts: {
      priorityDistribution,
      sourceTypeDistribution,
      timeline,
    },
    kpis: {
      completionRate,
      avgCompletionHours,
      onTimeRate,
      overdueTasks: stats.overdue,
      velocityThisWeek: completedThisWeek,
      velocityLastWeek: completedLastWeek,
      velocityTrend,
    },
    upcomingTasks: upcomingTasks.map((t: any) => ({
      _id: t.id,
      content: t.content || '',
      priority: t.priority || 'normal',
      status: t.status,
      sourceType: t.source_type || 'note',
      dueDate: t.due_date || null,
      createdAt: t.created_at,
    })),
  })
}
