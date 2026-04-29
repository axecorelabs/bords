'use client'

import {
  Bell,
  Users,
  CheckCircle2,
  Mail,
  UserPlus,
  X,
  LayoutGrid,
  Trash2,
  PartyPopper,
} from 'lucide-react'
import { DashboardData, formatRelativeTime } from './types'

export default function ActivityTab({ data, isDark }: { data: DashboardData; isDark: boolean }) {
  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'task_assigned': return { icon: UserPlus, color: 'blue' }
      case 'task_completed': return { icon: CheckCircle2, color: 'emerald' }
      case 'task_unassigned': return { icon: X, color: 'red' }
      case 'task_reassigned': return { icon: Users, color: 'amber' }
      case 'org_invitation': return { icon: Mail, color: 'purple' }
      case 'invitation_accepted': return { icon: CheckCircle2, color: 'emerald' }
      case 'board_added': return { icon: LayoutGrid, color: 'blue' }
      case 'board_removed': return { icon: Trash2, color: 'red' }
      case 'welcome': return { icon: PartyPopper, color: 'emerald' }
      default: return { icon: Bell, color: 'zinc' }
    }
  }

  const iconColorMap: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
    blue: { bg: 'bg-blue-100', text: 'text-blue-600', darkBg: 'bg-blue-500/15', darkText: 'text-blue-400' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600', darkBg: 'bg-emerald-500/15', darkText: 'text-emerald-400' },
    red: { bg: 'bg-red-100', text: 'text-red-600', darkBg: 'bg-red-500/15', darkText: 'text-red-400' },
    amber: { bg: 'bg-amber-100', text: 'text-amber-600', darkBg: 'bg-amber-500/15', darkText: 'text-amber-400' },
    purple: { bg: 'bg-purple-100', text: 'text-purple-600', darkBg: 'bg-purple-500/15', darkText: 'text-purple-400' },
    zinc: { bg: 'bg-zinc-100', text: 'text-zinc-600', darkBg: 'bg-zinc-700', darkText: 'text-zinc-400' },
  }

  return (
    <div>
      <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
        Activity
      </h1>
      <p className={`text-sm mb-8 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
        Recent activity in your organization
      </p>

      {data.recentActivity.length === 0 ? (
        <div className={`rounded-2xl border p-12 text-center ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <Bell size={40} className={`mx-auto mb-4 ${isDark ? 'text-zinc-600' : 'text-zinc-300'}`} />
          <p className={`text-sm font-medium ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
            No activity yet
          </p>
        </div>
      ) : (
        <div className={`rounded-2xl border overflow-hidden ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          {data.recentActivity.map((item, i) => {
            const { icon: Icon, color } = getActivityIcon(item.type)
            const c = iconColorMap[color]
            return (
              <div
                key={item._id}
                className={`flex items-start gap-4 px-5 py-4 ${
                  i < data.recentActivity.length - 1
                    ? isDark ? 'border-b border-zinc-700/30' : 'border-b border-zinc-100'
                    : ''
                } ${!item.isRead ? isDark ? 'bg-blue-500/5' : 'bg-blue-50/50' : ''}`}
              >
                <div className={`p-2 rounded-xl flex-shrink-0 ${isDark ? c.darkBg : c.bg}`}>
                  <Icon size={16} className={isDark ? c.darkText : c.text} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                    {item.title}
                  </p>
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    {item.message}
                  </p>
                </div>
                <p className={`text-xs flex-shrink-0 pt-0.5 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                  {formatRelativeTime(item.createdAt)}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
