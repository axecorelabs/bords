import { useRouter } from 'next/navigation'

export type TabId = 'overview' | 'inbox' | 'calendar' | 'my-tasks' | 'metrics' | 'members' | 'boards' | 'activity' | 'settings'

export interface DashboardData {
  organization: {
    _id: string
    name: string
    description: string | null
    logoUrl: string | null
    ownerId: string
    createdAt: string
  }
  isOwner: boolean
  members: {
    _id: string
    membershipId?: string
    email: string
    firstName: string
    lastName: string
    image: string
    joinedAt: string
    role?: 'admin' | 'member'
  }[]
  pendingInvitations: {
    _id: string
    email: string
    status: string
    createdAt: string
    orgRole?: 'admin' | 'member'
  }[]
  boards: {
    _id: string
    title: string
    localBoardId: string
    ownerId: string
    lastPublishedAt: string | null
    createdAt: string
    visibility: 'private' | 'org'
  }[]
  assignmentStats: {
    totalAssignments: number
    draft: number
    assigned: number
    completed: number
    highPriority: number
  }
  recentActivity: {
    _id: string
    type: string
    title: string
    message: string
    isRead: boolean
    createdAt: string
  }[]
  recentPublishes: {
    _id: string
    bordId: string
    versionNumber: number
    newCount: number
    reassignedCount: number
    unassignedCount: number
    createdAt: string
  }[]
  charts: {
    priorityDistribution: { low: number; normal: number; high: number }
    boardTaskBreakdown: { boardTitle: string; draft: number; assigned: number; completed: number }[]
    memberWorkload: { name: string; assigned: number; completed: number }[]
    timeline: { week: string; created: number; completed: number }[]
    sourceTypeDistribution: { note: number; checklist_item: number; kanban_task: number }
  }
  kpis: {
    completionRate: number
    avgCompletionHours: number | null
    onTimeRate: number | null
    overdueTasks: number
    velocityThisWeek: number
    velocityLastWeek: number
    velocityTrend: number
    tasksPerMember: number
    bottleneckTasks: number
    highPriorityAvgHours: number | null
    activeMembers: number
  }
  personalStats: {
    totalAssignments: number
    draft: number
    assigned: number
    completed: number
    highPriority: number
    overdue: number
  }
  personalKpis: {
    completionRate: number
    avgCompletionHours: number | null
    onTimeRate: number | null
    overdueTasks: number
    velocityThisWeek: number
    velocityLastWeek: number
    velocityTrend: number
  }
  memberMetrics: {
    userId: string
    name: string
    email: string
    image: string | null
    stats: {
      totalAssignments: number
      draft: number
      assigned: number
      completed: number
      highPriority: number
      overdue: number
    }
    kpis: {
      completionRate: number
      avgCompletionHours: number | null
      onTimeRate: number | null
      overdueTasks: number
      velocityThisWeek: number
      velocityLastWeek: number
      velocityTrend: number
    }
  }[]
}

export type RouterType = ReturnType<typeof useRouter>

export function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diff = now - date
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString()
}
