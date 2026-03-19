export type PersonalTabId = 'overview' | 'inbox' | 'calendar' | 'friends' | 'boards' | 'activity' | 'settings'

export interface PersonalDashboardData {
  profile: {
    _id: string
    email: string
    firstName: string
    lastName: string
    image: string | null
  }
  createdAt: string | null
  friends: {
    _id: string
    userId: string
    email: string
    nickname: string | null
    firstName: string
    lastName: string
    image: string | null
    status: 'pending' | 'accepted'
    createdAt: string
  }[]
  boards: {
    _id: string
    title: string
    localBoardId: string
    createdAt: string
    updatedAt: string
  }[]
  stats: {
    totalAssignments: number
    draft: number
    assigned: number
    completed: number
    highPriority: number
    overdue: number
  }
  sentStats: {
    total: number
    assigned: number
    completed: number
  }
  recentActivity: {
    _id: string
    type: string
    title: string
    message: string
    isRead: boolean
    createdAt: string
  }[]
  charts: {
    priorityDistribution: { low: number; normal: number; high: number }
    sourceTypeDistribution: { note: number; checklist_item: number; kanban_task: number }
    timeline: { week: string; created: number; completed: number }[]
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
  upcomingTasks: {
    _id: string
    content: string
    priority: string
    status: string
    sourceType: string
    dueDate: string | null
    createdAt: string
  }[]
}

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
