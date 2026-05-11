'use client'

import { useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Line, Doughnut } from 'react-chartjs-2'
import {
  Users,
  FolderKanban,
  CheckCircle2,
  Clock,
  TrendingUp,
  AlertTriangle,
  FileText,
  ArrowRight,
} from 'lucide-react'
import { DashboardData, TabId, formatRelativeTime } from './types'

ChartJS.register(
  CategoryScale,
  LinearScale,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

export default function OverviewTab({
  data,
  isDark,
  onNavigateTab,
}: {
  data: DashboardData
  isDark: boolean
  onNavigateTab: (tab: TabId) => void
  onRefresh: () => void
}) {
  const { assignmentStats, members, boards, recentActivity, recentPublishes, personalStats, isOwner } = data

  // For members, show personal stats; for owners show org-wide stats
  const statsSource = isOwner ? assignmentStats : {
    totalAssignments: personalStats.totalAssignments,
    draft: personalStats.draft,
    assigned: personalStats.assigned,
    completed: personalStats.completed,
    highPriority: personalStats.highPriority,
  }
  const completionRate = statsSource.totalAssignments > 0
    ? Math.round((statsSource.completed / statsSource.totalAssignments) * 100)
    : 0

  const ownerCards = [
    { label: 'Team Members', value: members.length, icon: Users, color: 'blue' },
    { label: 'Active Boards', value: boards.length, icon: FolderKanban, color: 'purple' },
    { label: 'Tasks Assigned', value: assignmentStats.assigned, icon: Clock, color: 'amber' },
    { label: 'Tasks Completed', value: assignmentStats.completed, icon: CheckCircle2, color: 'emerald' },
  ]

  const memberCards = [
    { label: 'My Tasks', value: personalStats.totalAssignments, icon: FileText, color: 'blue' },
    { label: 'In Progress', value: personalStats.assigned, icon: Clock, color: 'amber' },
    { label: 'Completed', value: personalStats.completed, icon: CheckCircle2, color: 'emerald' },
    { label: 'Overdue', value: personalStats.overdue, icon: AlertTriangle, color: personalStats.overdue > 0 ? 'red' : 'emerald' },
  ]

  const statCards = isOwner ? ownerCards : memberCards

  const colorMap: Record<string, { bg: string; text: string; darkBg: string; darkText: string }> = {
    blue: { bg: 'bg-blue-100', text: 'text-blue-600', darkBg: 'bg-blue-500/15', darkText: 'text-blue-400' },
    purple: { bg: 'bg-purple-100', text: 'text-purple-600', darkBg: 'bg-purple-500/15', darkText: 'text-purple-400' },
    amber: { bg: 'bg-amber-100', text: 'text-amber-600', darkBg: 'bg-amber-500/15', darkText: 'text-amber-400' },
    emerald: { bg: 'bg-emerald-100', text: 'text-emerald-600', darkBg: 'bg-emerald-500/15', darkText: 'text-emerald-400' },
    red: { bg: 'bg-red-100', text: 'text-red-600', darkBg: 'bg-red-500/15', darkText: 'text-red-400' },
  }

  return (
    <div>
      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
        {statCards.map((card) => {
          const c = colorMap[card.color]
          return (
            <div
              key={card.label}
              className={`rounded-2xl border p-5 ${
                isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className={`p-2 rounded-xl ${isDark ? c.darkBg : c.bg}`}>
                  <card.icon size={18} className={isDark ? c.darkText : c.text} />
                </div>
              </div>
              <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                {card.value}
              </p>
              <p className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                {card.label}
              </p>
            </div>
          )
        })}
      </div>

      {/* Completion progress */}
      {statsSource.totalAssignments > 0 && (
        <div className={`rounded-2xl border p-6 mt-4 ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className={`font-semibold text-sm ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                {isOwner ? 'Task Completion' : 'My Task Completion'}
              </h3>
              <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                {statsSource.completed} of {statsSource.totalAssignments} tasks completed
              </p>
            </div>
            <span className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
              {completionRate}%
            </span>
          </div>
          <div className={`w-full h-3 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700' : 'bg-zinc-100'}`}>
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${completionRate}%` }}
            />
          </div>
          <div className="flex gap-6 mt-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-zinc-400" />
              <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                Draft: {statsSource.draft}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                In Progress: {statsSource.assigned}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                Completed: {statsSource.completed}
              </span>
            </div>
            {statsSource.highPriority > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  High Priority: {statsSource.highPriority}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Overview charts — timeline + status doughnut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
        <div className={`col-span-2 rounded-2xl border p-5 ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <h3 className={`font-semibold text-sm mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            Assignment Timeline
          </h3>
          <div className="h-56">
            <OverviewTimeline charts={data.charts} isDark={isDark} />
          </div>
        </div>
        <div className={`rounded-2xl border p-5 ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <h3 className={`font-semibold text-sm mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            Task Status
          </h3>
          <div className="h-56">
            <OverviewStatusDoughnut stats={statsSource} isDark={isDark} />
          </div>
        </div>
      </div>

      {/* Two-column layout for recent activity and publishes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* Recent activity */}
        <div className={`rounded-2xl border p-5 ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <h3 className={`font-semibold text-sm mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            Recent Activity
          </h3>
          {data.recentActivity.length === 0 ? (
            <div className="py-8 text-center space-y-3">
              <p className={`text-xs ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                No recent activity
              </p>
              <button
                type="button"
                onClick={() => onNavigateTab('activity')}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${isDark ? 'bg-zinc-700/60 text-zinc-200 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}
              >
                View activity
                <ArrowRight size={12} />
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {data.recentActivity.slice(0, 5).map((item) => (
                <div key={item._id} className="flex items-start gap-3 rounded-xl px-2 py-1.5">
                  <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                    item.isRead
                      ? isDark ? 'bg-zinc-600' : 'bg-zinc-300'
                      : 'bg-blue-500'
                  }`} />
                  <div className="min-w-0">
                    <p className={`text-sm truncate ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                      {item.title}
                    </p>
                    <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      {formatRelativeTime(item.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent publishes */}
        <div className={`rounded-2xl border p-5 ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <h3 className={`font-semibold text-sm mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            Recent Publishes
          </h3>
          {recentPublishes.length === 0 ? (
            <div className="py-8 text-center space-y-3">
              <p className={`text-xs ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                No publishes yet
              </p>
              <button
                type="button"
                onClick={() => onNavigateTab('boards')}
                className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors ${isDark ? 'bg-zinc-700/60 text-zinc-200 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}
              >
                Open boards
                <ArrowRight size={12} />
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {recentPublishes.slice(0, 5).map((pub) => {
                const board = data.boards.find(b => b._id === pub.bordId)
                return (
                  <div key={pub._id} className={`flex items-center gap-3 p-3 rounded-xl ${
                    isDark ? 'bg-zinc-700/30' : 'bg-zinc-50'
                  }`}>
                    <div className={`p-1.5 rounded-lg ${isDark ? 'bg-blue-500/15' : 'bg-blue-100'}`}>
                      <TrendingUp size={14} className={isDark ? 'text-blue-400' : 'text-blue-600'} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium truncate ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                        v{pub.versionNumber}
                        {board && <span className={`font-normal ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}> — {board.title}</span>}
                      </p>
                      <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        {pub.newCount} new · {pub.reassignedCount} reassigned · {pub.unassignedCount} removed
                      </p>
                    </div>
                    <p className={`text-xs flex-shrink-0 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                      {formatRelativeTime(pub.createdAt)}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── Inline mini-chart components ── */

function OverviewTimeline({ charts, isDark }: { charts: DashboardData['charts']; isDark: boolean }) {
  const textColor = isDark ? '#a1a1aa' : '#71717a'
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
  const data = useMemo(() => ({
    labels: charts.timeline.map(t => t.week),
    datasets: [
      {
        label: 'Created',
        data: charts.timeline.map(t => t.created),
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96,165,250,0.1)',
        fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 5,
      },
      {
        label: 'Completed',
        data: charts.timeline.map(t => t.completed),
        borderColor: '#34d399',
        backgroundColor: 'rgba(52,211,153,0.1)',
        fill: true, tension: 0.35, pointRadius: 3, pointHoverRadius: 5,
      },
    ],
  }), [charts.timeline])

  const options = useMemo(() => ({
    responsive: true, maintainAspectRatio: false,
    scales: {
      x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } },
      y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } }, beginAtZero: true },
    },
    plugins: {
      legend: { position: 'bottom' as const, labels: { color: textColor, padding: 12, usePointStyle: true, pointStyleWidth: 8, font: { size: 11 } } },
      tooltip: {
        backgroundColor: isDark ? '#27272a' : '#fff',
        titleColor: isDark ? '#fafafa' : '#18181b',
        bodyColor: isDark ? '#a1a1aa' : '#52525b',
        borderColor: isDark ? '#3f3f46' : '#e4e4e7',
        borderWidth: 1, padding: 10, cornerRadius: 10, boxPadding: 4,
      },
    },
  }), [isDark, textColor, gridColor])

  return <Line data={data} options={options} />
}

function OverviewStatusDoughnut({
  stats,
  isDark,
}: {
  stats: { draft: number; assigned: number; completed: number }
  isDark: boolean
}) {
  const textColor = isDark ? '#a1a1aa' : '#71717a'
  const data = useMemo(() => ({
    labels: ['Draft', 'Assigned', 'Completed'],
    datasets: [{
      data: [stats.draft, stats.assigned, stats.completed],
      backgroundColor: ['#a1a1aa', '#f59e0b', '#10b981'],
      borderWidth: 0, hoverOffset: 6,
    }],
  }), [stats])

  const options = useMemo(() => ({
    responsive: true, maintainAspectRatio: false, cutout: '65%',
    plugins: {
      legend: { position: 'bottom' as const, labels: { color: textColor, padding: 12, usePointStyle: true, pointStyleWidth: 8, font: { size: 11 } } },
      tooltip: {
        backgroundColor: isDark ? '#27272a' : '#fff',
        titleColor: isDark ? '#fafafa' : '#18181b',
        bodyColor: isDark ? '#a1a1aa' : '#52525b',
        borderColor: isDark ? '#3f3f46' : '#e4e4e7',
        borderWidth: 1, padding: 10, cornerRadius: 10, boxPadding: 4,
      },
    },
  }), [isDark, textColor])

  return <Doughnut data={data} options={options} />
}
