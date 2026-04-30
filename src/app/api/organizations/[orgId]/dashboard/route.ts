import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getAuthUser, unauthorized, notFound, forbidden } from '@/lib/api-helpers'
import { cacheGet, cacheSet, CacheKeys, CacheTTL } from '@/lib/cache'

/**
 * GET /api/organizations/[orgId]/dashboard
 *
 * Aggregated dashboard data for an organization.
 * Returns: org info, member count, board count, assignment stats,
 * recent activity (notifications), and recent publish snapshots.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getAuthUser()
  if (!user) return unauthorized()

  const { orgId } = await params

  // Verify org exists and user has access
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('*')
    .eq('id', orgId)
    .maybeSingle()
  if (!org) return notFound('Organization')

  const isOwner = org.owner_id === user.id
  if (!isOwner) {
    const { data: membership } = await supabaseAdmin
      .from('employee_memberships')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) return forbidden()
  }

  // Check cache (per-user, since dashboard is personalized)
  const cacheKey = CacheKeys.orgDashboard(orgId, user.id)
  const cached = await cacheGet(cacheKey)
  if (cached) return NextResponse.json(cached)

  // Parallel fetch all dashboard data
  const [
    membersRes,
    invitationsRes,
    bordsRes,
    assignmentsRes,
    notificationsRes,
    snapshotsRes,
  ] = await Promise.all([
    // Members
    supabaseAdmin
      .from('employee_memberships')
      .select('id, user_id, role, created_at')
      .eq('organization_id', orgId),
    // Pending invitations
    supabaseAdmin
      .from('invitations')
      .select('id, email, status, org_role, created_at')
      .eq('organization_id', orgId)
      .eq('status', 'pending'),
    // Boards linked to org
    supabaseAdmin
      .from('bords')
      .select('id, title, local_board_id, owner_id, last_published_at, created_at, visibility')
      .eq('organization_id', orgId),
    // All assignments across org boards
    supabaseAdmin
      .from('task_assignments')
      .select('id, bord_id, status, priority, assigned_to, source_type, due_date, created_at, published_at, completed_at, is_deleted')
      .in('bord_id', (await supabaseAdmin.from('bords').select('id').eq('organization_id', orgId)).data?.map(b => b.id) || []),
    // Recent notifications for org context
    supabaseAdmin
      .from('notifications')
      .select('id, type, title, message, metadata, is_read, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20),
    // Recent publish snapshots
    supabaseAdmin
      .from('publish_snapshots')
      .select('id, bord_id, version_number, new_assignments_count, reassigned_count, unassigned_count, created_at')
      .in('bord_id', (await supabaseAdmin.from('bords').select('id').eq('organization_id', orgId)).data?.map(b => b.id) || [])
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const members = membersRes.data || []
  const pendingInvitations = invitationsRes.data || []
  const allOrgBords = bordsRes.data || []
  const assignments = assignmentsRes.data || []
  const notifications = notificationsRes.data || []
  const snapshots = snapshotsRes.data || []

  // For non-owners, filter boards to only those they own or have access to
  let bords = allOrgBords
  if (!isOwner) {
    const allOrgBordIds = allOrgBords.map((b: any) => b.id)
    const [accessRes, memberBordRes] = await Promise.all([
      allOrgBordIds.length > 0
        ? supabaseAdmin
            .from('bord_access_list')
            .select('bord_id')
            .eq('user_id', user.id)
            .in('bord_id', allOrgBordIds)
        : { data: [] },
      allOrgBordIds.length > 0
        ? supabaseAdmin
            .from('bord_members')
            .select('bord_id')
            .eq('user_id', user.id)
            .in('bord_id', allOrgBordIds)
        : { data: [] },
    ])
    const accessibleIds = new Set([
      ...((accessRes.data || []).map((a: any) => a.bord_id)),
      ...((memberBordRes.data || []).map((m: any) => m.bord_id)),
    ])
    bords = allOrgBords.filter((b: any) => b.owner_id === user.id || accessibleIds.has(b.id))
  }

  // Filter notifications to org context
  const orgNotifications = notifications.filter((n: any) =>
    n.metadata?.organizationId === orgId
  )

  // Compute assignment stats
  const activeAssignments = assignments.filter((a: any) => !a.is_deleted)
  const stats = {
    totalAssignments: activeAssignments.length,
    draft: activeAssignments.filter((a: any) => a.status === 'draft').length,
    assigned: activeAssignments.filter((a: any) => a.status === 'assigned').length,
    completed: activeAssignments.filter((a: any) => a.status === 'completed').length,
    highPriority: activeAssignments.filter((a: any) => a.priority === 'high').length,
  }

  // Get unique assignees
  const assigneeIds = [...new Set(activeAssignments.map((a: any) => a.assigned_to))]

  // Personal stats for the current user (member view)
  const nowMs = Date.now()
  const myAssignments = activeAssignments.filter((a: any) => a.assigned_to === user.id)
  const personalStats = {
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

  // ── Chart data ──

  // Priority distribution
  const priorityDistribution = {
    low: activeAssignments.filter((a: any) => a.priority === 'low').length,
    normal: activeAssignments.filter((a: any) => a.priority === 'normal').length,
    high: activeAssignments.filter((a: any) => a.priority === 'high').length,
  }

  // Per-board task breakdown
  const boardTaskBreakdown = bords.map((b: any) => {
    const boardAssignments = activeAssignments.filter((a: any) => a.bord_id === b.id)
    return {
      boardTitle: b.title,
      draft: boardAssignments.filter((a: any) => a.status === 'draft').length,
      assigned: boardAssignments.filter((a: any) => a.status === 'assigned').length,
      completed: boardAssignments.filter((a: any) => a.status === 'completed').length,
    }
  }).filter((b: any) => b.draft + b.assigned + b.completed > 0)

  // Member profiles (needed for workload names) — include owner
  const memberUserIds = members.map((m: any) => m.user_id)
  const allUserIds = [...new Set([...memberUserIds, org.owner_id])]
  const { data: profiles } = allUserIds.length > 0
    ? await supabaseAdmin.from('profiles').select('id, email, first_name, last_name, image').in('id', allUserIds)
    : { data: [] }

  // Per-member workload (tasks assigned to each member)
  const memberWorkload: { name: string; assigned: number; completed: number }[] = []
  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]))
  for (const userId of assigneeIds) {
    const userAssignments = activeAssignments.filter((a: any) => a.assigned_to === userId)
    const profile = profileMap.get(userId)
    const name = profile
      ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.email
      : 'Unknown'
    memberWorkload.push({
      name,
      assigned: userAssignments.filter((a: any) => a.status === 'assigned').length,
      completed: userAssignments.filter((a: any) => a.status === 'completed').length,
    })
  }
  memberWorkload.sort((a, b) => (b.assigned + b.completed) - (a.assigned + a.completed))

  // Assignment timeline — group by week for last 8 weeks
  const now = new Date()
  const timeline: { week: string; created: number; completed: number }[] = []
  for (let i = 7; i >= 0; i--) {
    const weekStart = new Date(now)
    weekStart.setDate(weekStart.getDate() - i * 7)
    weekStart.setHours(0, 0, 0, 0)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`
    const created = activeAssignments.filter((a: any) => {
      const d = new Date(a.created_at)
      return d >= weekStart && d < weekEnd
    }).length
    const completed = assignments.filter((a: any) => {
      if (!a.completed_at) return false
      const d = new Date(a.completed_at)
      return d >= weekStart && d < weekEnd
    }).length
    timeline.push({ week: label, created, completed })
  }

  // Source type distribution (what type of items are being assigned)
  const sourceTypeDistribution = {
    note: activeAssignments.filter((a: any) => a.source_type === 'note').length,
    checklist_item: activeAssignments.filter((a: any) => a.source_type === 'checklist_item').length,
    kanban_task: activeAssignments.filter((a: any) => a.source_type === 'kanban_task').length,
  }

  // ── KPI computations ──

  // Completion rate
  const completionRate = activeAssignments.length > 0
    ? Math.round((stats.completed / activeAssignments.length) * 100)
    : 0

  // Average completion time (published_at → completed_at, in hours)
  const completedWithTimes = activeAssignments.filter(
    (a: any) => a.status === 'completed' && a.completed_at && a.published_at
  )
  const avgCompletionHours = completedWithTimes.length > 0
    ? completedWithTimes.reduce((sum: number, a: any) => {
        return sum + (new Date(a.completed_at).getTime() - new Date(a.published_at).getTime())
      }, 0) / completedWithTimes.length / (1000 * 60 * 60)
    : null

  // On-time delivery rate (completed tasks with a due_date, completed before due)
  const completedWithDue = activeAssignments.filter(
    (a: any) => a.status === 'completed' && a.due_date && a.completed_at
  )
  const onTimeCount = completedWithDue.filter(
    (a: any) => new Date(a.completed_at) <= new Date(a.due_date)
  ).length
  const onTimeRate = completedWithDue.length > 0
    ? Math.round((onTimeCount / completedWithDue.length) * 100)
    : null

  // Overdue tasks (assigned + has due_date in the past + not completed)
  const overdueTasks = activeAssignments.filter((a: any) => {
    if (a.status === 'completed' || !a.due_date) return false
    return new Date(a.due_date).getTime() < nowMs
  }).length

  // Team velocity — tasks completed this week vs last week
  const thisWeekStart = new Date(now)
  thisWeekStart.setDate(thisWeekStart.getDate() - 7)
  thisWeekStart.setHours(0, 0, 0, 0)
  const lastWeekStart = new Date(thisWeekStart)
  lastWeekStart.setDate(lastWeekStart.getDate() - 7)

  const completedThisWeek = activeAssignments.filter((a: any) => {
    if (!a.completed_at) return false
    const d = new Date(a.completed_at).getTime()
    return d >= thisWeekStart.getTime() && d < nowMs
  }).length

  const completedLastWeek = activeAssignments.filter((a: any) => {
    if (!a.completed_at) return false
    const d = new Date(a.completed_at).getTime()
    return d >= lastWeekStart.getTime() && d < thisWeekStart.getTime()
  }).length

  const velocityTrend = completedLastWeek > 0
    ? Math.round(((completedThisWeek - completedLastWeek) / completedLastWeek) * 100)
    : completedThisWeek > 0 ? 100 : 0

  // Avg tasks per member
  const activeMembers = assigneeIds.length
  const tasksPerMember = activeMembers > 0
    ? Math.round((stats.assigned + stats.completed) * 10 / activeMembers) / 10
    : 0

  // Bottleneck — tasks assigned for > 7 days without completion
  const bottleneckThreshold = 7 * 24 * 60 * 60 * 1000
  const bottleneckTasks = activeAssignments.filter((a: any) => {
    if (a.status !== 'assigned' || !a.published_at) return false
    return (nowMs - new Date(a.published_at).getTime()) > bottleneckThreshold
  }).length

  // High priority avg completion time
  const highPriorityCompleted = completedWithTimes.filter((a: any) => a.priority === 'high')
  const highPriorityAvgHours = highPriorityCompleted.length > 0
    ? highPriorityCompleted.reduce((sum: number, a: any) => {
        return sum + (new Date(a.completed_at).getTime() - new Date(a.published_at).getTime())
      }, 0) / highPriorityCompleted.length / (1000 * 60 * 60)
    : null

  const kpis = {
    completionRate,
    avgCompletionHours,
    onTimeRate,
    overdueTasks,
    velocityThisWeek: completedThisWeek,
    velocityLastWeek: completedLastWeek,
    velocityTrend,
    tasksPerMember,
    bottleneckTasks,
    highPriorityAvgHours,
    activeMembers,
  }

  // ── Personal KPIs (for the logged-in user) ──
  const myCompleted = myAssignments.filter((a: any) => a.status === 'completed')
  const myCompletedWithTimes = myAssignments.filter(
    (a: any) => a.status === 'completed' && a.completed_at && a.published_at
  )
  const myAvgCompletionHours = myCompletedWithTimes.length > 0
    ? myCompletedWithTimes.reduce((sum: number, a: any) => {
        return sum + (new Date(a.completed_at).getTime() - new Date(a.published_at).getTime())
      }, 0) / myCompletedWithTimes.length / (1000 * 60 * 60)
    : null

  const myCompletedWithDue = myAssignments.filter(
    (a: any) => a.status === 'completed' && a.due_date && a.completed_at
  )
  const myOnTimeCount = myCompletedWithDue.filter(
    (a: any) => new Date(a.completed_at) <= new Date(a.due_date)
  ).length
  const myOnTimeRate = myCompletedWithDue.length > 0
    ? Math.round((myOnTimeCount / myCompletedWithDue.length) * 100)
    : null

  const myCompletedThisWeek = myAssignments.filter((a: any) => {
    if (!a.completed_at) return false
    const d = new Date(a.completed_at).getTime()
    return d >= thisWeekStart.getTime() && d < nowMs
  }).length
  const myCompletedLastWeek = myAssignments.filter((a: any) => {
    if (!a.completed_at) return false
    const d = new Date(a.completed_at).getTime()
    return d >= lastWeekStart.getTime() && d < thisWeekStart.getTime()
  }).length
  const myVelocityTrend = myCompletedLastWeek > 0
    ? Math.round(((myCompletedThisWeek - myCompletedLastWeek) / myCompletedLastWeek) * 100)
    : myCompletedThisWeek > 0 ? 100 : 0

  const personalKpis = {
    completionRate: myAssignments.length > 0
      ? Math.round((myCompleted.length / myAssignments.length) * 100)
      : 0,
    avgCompletionHours: myAvgCompletionHours,
    onTimeRate: myOnTimeRate,
    overdueTasks: personalStats.overdue,
    velocityThisWeek: myCompletedThisWeek,
    velocityLastWeek: myCompletedLastWeek,
    velocityTrend: myVelocityTrend,
  }

  // ── Per-member metrics (for owner's member drill-down) ──
  const memberMetrics = isOwner
    ? allUserIds.map((uid: string) => {
        const ua = activeAssignments.filter((a: any) => a.assigned_to === uid)
        const profile = profileMap.get(uid)
        const name = profile
          ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.email
          : 'Unknown'
        const total = ua.length
        const draft = ua.filter((a: any) => a.status === 'draft').length
        const assigned = ua.filter((a: any) => a.status === 'assigned').length
        const completed = ua.filter((a: any) => a.status === 'completed').length
        const highPriority = ua.filter((a: any) => a.priority === 'high').length
        const overdue = ua.filter((a: any) => {
          if (a.status === 'completed' || !a.due_date) return false
          return new Date(a.due_date).getTime() < nowMs
        }).length

        const cwt = ua.filter(
          (a: any) => a.status === 'completed' && a.completed_at && a.published_at
        )
        const avgHrs = cwt.length > 0
          ? cwt.reduce((s: number, a: any) =>
              s + (new Date(a.completed_at).getTime() - new Date(a.published_at).getTime()), 0
            ) / cwt.length / (1000 * 60 * 60)
          : null

        const cwd = ua.filter(
          (a: any) => a.status === 'completed' && a.due_date && a.completed_at
        )
        const otc = cwd.filter(
          (a: any) => new Date(a.completed_at) <= new Date(a.due_date)
        ).length
        const otRate = cwd.length > 0 ? Math.round((otc / cwd.length) * 100) : null

        const ctw = ua.filter((a: any) => {
          if (!a.completed_at) return false
          const d = new Date(a.completed_at).getTime()
          return d >= thisWeekStart.getTime() && d < nowMs
        }).length
        const clw = ua.filter((a: any) => {
          if (!a.completed_at) return false
          const d = new Date(a.completed_at).getTime()
          return d >= lastWeekStart.getTime() && d < thisWeekStart.getTime()
        }).length
        const vt = clw > 0
          ? Math.round(((ctw - clw) / clw) * 100)
          : ctw > 0 ? 100 : 0

        return {
          userId: uid,
          name,
          email: profile?.email || '',
          image: profile?.image || null,
          stats: { totalAssignments: total, draft, assigned, completed, highPriority, overdue },
          kpis: {
            completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
            avgCompletionHours: avgHrs,
            onTimeRate: otRate,
            overdueTasks: overdue,
            velocityThisWeek: ctw,
            velocityLastWeek: clw,
            velocityTrend: vt,
          },
        }
      })
    : []

  const body = {
    organization: {
      _id: org.id,
      name: org.name,
      description: org.description || null,
      logoUrl: org.logo_url || null,
      ownerId: org.owner_id,
      createdAt: org.created_at,
    },
    isOwner,
    members: (profiles || []).map((p: any) => {
      const membership = members.find((m: any) => m.user_id === p.id)
      return {
        _id: p.id,
        membershipId: membership?.id,
        email: p.email,
        firstName: p.first_name,
        lastName: p.last_name,
        image: p.image,
        joinedAt: membership?.created_at || org.created_at,
        role: membership?.role || 'member',
      }
    }),
    pendingInvitations: pendingInvitations.map((i: any) => ({
      _id: i.id,
      email: i.email,
      status: i.status,
      createdAt: i.created_at,
      orgRole: i.org_role || 'member',
    })),
    boards: bords.map((b: any) => ({
      _id: b.id,
      title: b.title,
      localBoardId: b.local_board_id,
      ownerId: b.owner_id,
      lastPublishedAt: b.last_published_at,
      createdAt: b.created_at,
      visibility: b.visibility || 'private',
    })),
    assignmentStats: stats,
    recentActivity: orgNotifications.slice(0, 15).map((n: any) => ({
      _id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      isRead: n.is_read,
      createdAt: n.created_at,
    })),
    recentPublishes: snapshots.map((s: any) => ({
      _id: s.id,
      bordId: s.bord_id,
      versionNumber: s.version_number,
      newCount: s.new_assignments_count,
      reassignedCount: s.reassigned_count,
      unassignedCount: s.unassigned_count,
      createdAt: s.created_at,
    })),
    // Chart data
    charts: {
      priorityDistribution,
      boardTaskBreakdown,
      memberWorkload,
      timeline,
      sourceTypeDistribution,
    },
    kpis,
    personalStats,
    personalKpis,
    memberMetrics,
  }

  await cacheSet(cacheKey, body, CacheTTL.ORG_DASHBOARD)

  return NextResponse.json(body)
}
