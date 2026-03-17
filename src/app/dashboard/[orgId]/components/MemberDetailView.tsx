'use client'

import {
  ArrowLeft,
  Target,
  Clock,
  CheckCircle2,
  AlertTriangle,
  FileText,
  TrendingUp,
  TrendingDown,
  Minus,
  Flame,
} from 'lucide-react'
import type { DashboardData } from './types'

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`
  return `${Math.round((hours / 24) * 10) / 10}d`
}

export default function MemberDetailView({
  member,
  isDark,
  onBack,
}: {
  member: DashboardData['memberMetrics'][number]
  isDark: boolean
  onBack: () => void
}) {
  const cardBg = isDark ? 'bg-zinc-800/50' : 'bg-white'
  const cardBorder = isDark ? 'border-zinc-700/50' : 'border-zinc-200'
  const mutedText = isDark ? 'text-zinc-400' : 'text-zinc-500'

  const completionRate = member.stats.totalAssignments > 0
    ? Math.round((member.stats.completed / member.stats.totalAssignments) * 100)
    : 0

  const kpiCards: { label: string; value: string; sub?: string; color?: string; trend?: number }[] = [
    {
      label: 'Completion Rate',
      value: `${member.kpis.completionRate}%`,
      color: member.kpis.completionRate >= 70 ? 'text-emerald-500' : member.kpis.completionRate >= 40 ? 'text-amber-500' : 'text-red-500',
    },
    {
      label: 'Avg Completion Time',
      value: member.kpis.avgCompletionHours != null ? formatHours(member.kpis.avgCompletionHours) : '—',
      sub: 'published → completed',
    },
    {
      label: 'On-Time Delivery',
      value: member.kpis.onTimeRate != null ? `${member.kpis.onTimeRate}%` : '—',
      color: member.kpis.onTimeRate != null && member.kpis.onTimeRate >= 70 ? 'text-emerald-500' : member.kpis.onTimeRate != null && member.kpis.onTimeRate < 50 ? 'text-red-500' : '',
    },
    {
      label: 'Weekly Velocity',
      value: `${member.kpis.velocityThisWeek}`,
      sub: `last week: ${member.kpis.velocityLastWeek}`,
      trend: member.kpis.velocityTrend,
    },
  ]

  return (
    <div>
      {/* Header */}
      <button
        onClick={onBack}
        className={`flex items-center gap-2 text-sm mb-6 transition-colors ${
          isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'
        }`}
      >
        <ArrowLeft size={16} />
        Back to Members
      </button>

      {/* Member profile card */}
      <div className={`${cardBg} border ${cardBorder} rounded-2xl p-6 mb-6`}>
        <div className="flex items-center gap-4">
          {member.image ? (
            <img src={member.image} alt="" className="w-14 h-14 rounded-full object-cover" />
          ) : (
            <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold ${
              isDark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'
            }`}>
              {(member.name[0] || member.email[0]).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className={`text-xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
              {member.name}
            </h1>
            <p className={`text-sm ${mutedText}`}>{member.email}</p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Total', value: member.stats.totalAssignments, icon: FileText, color: 'blue' },
          { label: 'Draft', value: member.stats.draft, icon: Clock, color: 'zinc' },
          { label: 'In Progress', value: member.stats.assigned, icon: Target, color: 'amber' },
          { label: 'Completed', value: member.stats.completed, icon: CheckCircle2, color: 'emerald' },
          { label: 'High Priority', value: member.stats.highPriority, icon: Flame, color: 'red' },
          { label: 'Overdue', value: member.stats.overdue, icon: AlertTriangle, color: member.stats.overdue > 0 ? 'red' : 'zinc' },
        ].map((s) => {
          const isAlert = s.label === 'Overdue' && s.value > 0
          return (
            <div key={s.label} className={`${cardBg} border ${isAlert ? 'border-red-500/40' : cardBorder} rounded-xl p-4 text-center`}>
              <s.icon size={16} className={`mx-auto mb-2 ${mutedText}`} />
              <p className={`text-xl font-bold ${isAlert ? 'text-red-500' : isDark ? 'text-white' : 'text-zinc-900'}`}>
                {s.value}
              </p>
              <p className={`text-[10px] mt-1 ${mutedText}`}>{s.label}</p>
            </div>
          )
        })}
      </div>

      {/* Completion progress bar */}
      {member.stats.totalAssignments > 0 && (
        <div className={`${cardBg} border ${cardBorder} rounded-2xl p-5 mb-6`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
              Task Completion
            </h3>
            <span className={`text-lg font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
              {completionRate}%
            </span>
          </div>
          <div className={`w-full h-2.5 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700' : 'bg-zinc-100'}`}>
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${completionRate}%` }}
            />
          </div>
          <p className={`text-xs mt-2 ${mutedText}`}>
            {member.stats.completed} of {member.stats.totalAssignments} tasks completed
          </p>
        </div>
      )}

      {/* KPI cards */}
      <h3 className={`text-sm font-semibold uppercase tracking-wider mb-3 ${mutedText}`}>
        Performance Metrics
      </h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className={`${cardBg} border ${cardBorder} rounded-xl p-5`}>
            <p className={`text-[10px] uppercase tracking-wider mb-2 ${mutedText}`}>{kpi.label}</p>
            <div className="flex items-center gap-2">
              <p className={`text-2xl font-bold ${kpi.color || ''}`}>{kpi.value}</p>
              {kpi.trend !== undefined && (
                <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${
                  kpi.trend === 0
                    ? 'text-zinc-400 bg-zinc-500/10'
                    : kpi.trend > 0
                      ? 'text-emerald-500 bg-emerald-500/10'
                      : 'text-red-500 bg-red-500/10'
                }`}>
                  {kpi.trend === 0 ? <Minus size={10} /> : kpi.trend > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                  {Math.abs(kpi.trend)}%
                </span>
              )}
            </div>
            {kpi.sub && <p className={`text-[10px] mt-1 ${mutedText}`}>{kpi.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
