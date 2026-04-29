'use client'

import { Activity } from 'lucide-react'
import { PersonalDashboardData, formatRelativeTime } from './types'

export default function PersonalActivityTab({
  data,
  isDark,
}: {
  data: PersonalDashboardData
  isDark: boolean
}) {
  return (
    <div>
      <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Activity</h1>
      <p className={`text-sm mb-8 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
        Recent personal activity
      </p>

      {data.recentActivity.length === 0 ? (
        <div className={`rounded-2xl border p-12 text-center ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <Activity size={40} className={`mx-auto mb-4 ${isDark ? 'text-zinc-600' : 'text-zinc-300'}`} />
          <p className={`text-sm font-medium ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
            No recent activity
          </p>
        </div>
      ) : (
        <div className={`rounded-2xl border divide-y ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50 divide-zinc-700/50' : 'bg-white border-zinc-200 divide-zinc-100'
        }`}>
          {data.recentActivity.map((item) => (
            <div key={item._id} className="flex items-start gap-3 px-5 py-4">
              <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                item.type === 'task_completed' ? 'bg-green-400' :
                item.type === 'task_assigned' ? 'bg-blue-400' :
                item.type === 'friend_request' ? 'bg-purple-400' :
                item.type === 'welcome' ? 'bg-emerald-400' :
                'bg-zinc-400'
              }`} />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                  {item.title}
                </p>
                <p className={`text-sm mt-0.5 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                  {item.message}
                </p>
                <p className={`text-xs mt-1 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                  {formatRelativeTime(item.createdAt)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
