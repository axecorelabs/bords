'use client'

import KpiCards from './KpiCards'
import DashboardCharts from './DashboardCharts'
import type { DashboardData } from './types'
import {
  BarChart3,
  User,
  Building2,
} from 'lucide-react'

export default function MetricsTab({
  data,
  isDark,
}: {
  data: DashboardData
  isDark: boolean
}) {
  const isOwner = data.isOwner
  const cardBg = isDark ? 'bg-zinc-800/60' : 'bg-white'
  const cardBorder = isDark ? 'border-zinc-700/50' : 'border-zinc-200'
  const mutedText = isDark ? 'text-zinc-400' : 'text-zinc-500'

  return (
    <div className="space-y-8">
      <div>
        <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
          Metrics
        </h1>
        <p className={`text-sm ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
          {isOwner ? 'KPIs and charts for your organization' : 'Your performance and team overview'}
        </p>
      </div>

      {/* Personal KPIs — shown to everyone */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <User size={18} className={mutedText} />
          <h2 className={`text-sm font-semibold uppercase tracking-wider ${mutedText}`}>
            {isOwner ? 'Your Personal Metrics' : 'My Metrics'}
          </h2>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-4">
          {[
            { label: 'My Tasks', value: data.personalStats.totalAssignments },
            { label: 'In Progress', value: data.personalStats.assigned },
            { label: 'Completed', value: data.personalStats.completed },
            { label: 'Overdue', value: data.personalStats.overdue, alert: data.personalStats.overdue > 0 },
          ].map((s) => (
            <div
              key={s.label}
              className={`${cardBg} border ${s.alert ? 'border-red-500/50' : cardBorder} rounded-xl p-4`}
            >
              <p className={`text-xs ${mutedText}`}>{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.alert ? 'text-red-500' : ''}`}>{s.value}</p>
            </div>
          ))}
        </div>
        <KpiCards
          kpis={{
            ...data.personalKpis,
            tasksPerMember: data.personalStats.totalAssignments,
            bottleneckTasks: 0,
            highPriorityAvgHours: null,
            activeMembers: 1,
          }}
          isDark={isDark}
        />
      </section>

      {/* Org-wide KPIs — owner only */}
      {isOwner && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={18} className={mutedText} />
            <h2 className={`text-sm font-semibold uppercase tracking-wider ${mutedText}`}>
              Organization Metrics
            </h2>
          </div>
          <KpiCards kpis={data.kpis} isDark={isDark} />
        </section>
      )}

      {/* Charts */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={18} className={mutedText} />
          <h2 className={`text-sm font-semibold uppercase tracking-wider ${mutedText}`}>
            {isOwner ? 'Organization Charts' : 'Team Overview'}
          </h2>
        </div>
        <DashboardCharts
          charts={data.charts}
          isDark={isDark}
          assignmentStats={data.assignmentStats}
        />
      </section>
    </div>
  )
}
