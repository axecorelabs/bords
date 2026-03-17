'use client'

import {
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  Zap,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Users,
  Gauge,
  Flame,
} from 'lucide-react'
import type { DashboardData } from './types'

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${Math.round(hours * 10) / 10}h`
  const days = Math.round(hours / 24 * 10) / 10
  return `${days}d`
}

function TrendBadge({ value, inverted = false }: { value: number; inverted?: boolean }) {
  const isPositive = inverted ? value <= 0 : value > 0
  const isNeutral = value === 0
  const Icon = isNeutral ? Minus : value > 0 ? TrendingUp : TrendingDown
  const color = isNeutral
    ? 'text-zinc-400 bg-zinc-500/10'
    : isPositive
      ? 'text-emerald-500 bg-emerald-500/10'
      : 'text-red-500 bg-red-500/10'

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${color}`}>
      <Icon size={10} />
      {Math.abs(value)}%
    </span>
  )
}

export default function KpiCards({
  kpis,
  isDark,
}: {
  kpis: DashboardData['kpis']
  isDark: boolean
}) {
  const cards: {
    label: string
    value: string
    subtitle?: string
    icon: typeof Target
    color: string
    trend?: number
    trendInverted?: boolean
    alert?: boolean
  }[] = [
    {
      label: 'Completion Rate',
      value: `${kpis.completionRate}%`,
      icon: Target,
      color: 'blue',
      subtitle: 'of all tasks',
    },
    {
      label: 'Avg Completion Time',
      value: kpis.avgCompletionHours !== null ? formatHours(kpis.avgCompletionHours) : '—',
      icon: Clock,
      color: 'purple',
      subtitle: 'assigned → done',
    },
    {
      label: 'On-Time Rate',
      value: kpis.onTimeRate !== null ? `${kpis.onTimeRate}%` : '—',
      icon: CheckCircle2,
      color: 'emerald',
      subtitle: kpis.onTimeRate !== null ? 'of tasks with deadlines' : 'no deadlines set',
    },
    {
      label: 'Weekly Velocity',
      value: `${kpis.velocityThisWeek}`,
      icon: Zap,
      color: 'amber',
      trend: kpis.velocityTrend,
      subtitle: `${kpis.velocityLastWeek} last week`,
    },
    {
      label: 'Overdue Tasks',
      value: `${kpis.overdueTasks}`,
      icon: AlertTriangle,
      color: kpis.overdueTasks > 0 ? 'red' : 'emerald',
      alert: kpis.overdueTasks > 0,
      subtitle: kpis.overdueTasks > 0 ? 'need attention' : 'all on track',
    },
    {
      label: 'Bottleneck Tasks',
      value: `${kpis.bottleneckTasks}`,
      icon: Flame,
      color: kpis.bottleneckTasks > 0 ? 'red' : 'emerald',
      alert: kpis.bottleneckTasks > 0,
      subtitle: '> 7 days assigned',
    },
    {
      label: 'Tasks per Member',
      value: `${kpis.tasksPerMember}`,
      icon: Users,
      color: 'indigo',
      subtitle: `across ${kpis.activeMembers} member${kpis.activeMembers !== 1 ? 's' : ''}`,
    },
    {
      label: 'High Priority Avg',
      value: kpis.highPriorityAvgHours !== null ? formatHours(kpis.highPriorityAvgHours) : '—',
      icon: Gauge,
      color: 'rose',
      subtitle: 'resolution time',
    },
  ]

  const colorMap: Record<string, { bg: string; text: string; darkBg: string; darkText: string; ring: string }> = {
    blue: { bg: 'bg-blue-100', text: 'text-blue-600', darkBg: 'bg-blue-500/15', darkText: 'text-blue-400', ring: 'ring-blue-500/20' },
    purple: { bg: 'bg-purple-100', text: 'text-purple-600', darkBg: 'bg-purple-500/15', darkText: 'text-purple-400', ring: 'ring-purple-500/20' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600', darkBg: 'bg-emerald-500/15', darkText: 'text-emerald-400', ring: 'ring-emerald-500/20' },
    amber: { bg: 'bg-amber-100', text: 'text-amber-600', darkBg: 'bg-amber-500/15', darkText: 'text-amber-400', ring: 'ring-amber-500/20' },
    red: { bg: 'bg-red-100', text: 'text-red-600', darkBg: 'bg-red-500/15', darkText: 'text-red-400', ring: 'ring-red-500/20' },
    indigo: { bg: 'bg-indigo-100', text: 'text-indigo-600', darkBg: 'bg-indigo-500/15', darkText: 'text-indigo-400', ring: 'ring-indigo-500/20' },
    rose: { bg: 'bg-rose-100', text: 'text-rose-600', darkBg: 'bg-rose-500/15', darkText: 'text-rose-400', ring: 'ring-rose-500/20' },
  }

  return (
    <div className="mb-8">
      <h3 className={`font-semibold text-sm mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
        Key Performance Indicators
      </h3>
      <div className="grid grid-cols-4 gap-3">
        {cards.map((card) => {
          const c = colorMap[card.color]
          return (
            <div
              key={card.label}
              className={`rounded-2xl border p-4 transition-all ${
                card.alert
                  ? isDark
                    ? 'bg-red-500/5 border-red-500/20 ring-1 ring-red-500/10'
                    : 'bg-red-50/50 border-red-200 ring-1 ring-red-100'
                  : isDark
                    ? 'bg-zinc-800/50 border-zinc-700/50'
                    : 'bg-white border-zinc-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`p-1.5 rounded-lg ${isDark ? c.darkBg : c.bg}`}>
                  <card.icon size={14} className={isDark ? c.darkText : c.text} />
                </div>
                {card.trend !== undefined && <TrendBadge value={card.trend} />}
              </div>
              <p className={`text-xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                {card.value}
              </p>
              <p className={`text-[11px] font-medium mt-0.5 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                {card.label}
              </p>
              {card.subtitle && (
                <p className={`text-[10px] mt-0.5 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                  {card.subtitle}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
