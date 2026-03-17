'use client'

import { useState } from 'react'
import {
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Flame,
  FolderKanban,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  CircleDot,
} from 'lucide-react'
import { PersonalDashboardData, formatRelativeTime } from './types'
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler } from 'chart.js'
import { Doughnut, Line, Bar } from 'react-chartjs-2'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler)

export default function PersonalOverviewTab({
  data,
  isDark,
  onOpenBoard,
}: {
  data: PersonalDashboardData
  isDark: boolean
  onOpenBoard: (localBoardId: string) => void
}) {
  const [showAnalytics, setShowAnalytics] = useState(false)

  const cardBg = isDark ? 'bg-zinc-800/50' : 'bg-white'
  const cardBorder = isDark ? 'border-zinc-700/50' : 'border-zinc-200'
  const mutedText = isDark ? 'text-zinc-400' : 'text-zinc-500'

  const { stats, charts, upcomingTasks } = data
  const firstName = data.profile.firstName || 'there'

  const completionRate = stats.totalAssignments > 0
    ? Math.round((stats.completed / stats.totalAssignments) * 100)
    : 0

  // Build summary sentence
  const summaryParts: string[] = []
  if (stats.overdue > 0) summaryParts.push(`${stats.overdue} overdue task${stats.overdue > 1 ? 's' : ''}`)
  if (stats.assigned > 0) summaryParts.push(`${stats.assigned} task${stats.assigned > 1 ? 's' : ''} in progress`)
  if (stats.highPriority > 0) summaryParts.push(`${stats.highPriority} high priority`)
  const summary = summaryParts.length > 0
    ? `You have ${summaryParts.join(', ')}.`
    : stats.totalAssignments > 0
      ? `All caught up! ${stats.completed} task${stats.completed !== 1 ? 's' : ''} completed.`
      : 'No tasks yet. Create a board to get started!'

  const priorityColors: Record<string, string> = {
    high: 'text-red-500',
    normal: isDark ? 'text-zinc-300' : 'text-zinc-700',
    low: 'text-blue-400',
  }

  const priorityBadge: Record<string, { bg: string; text: string }> = {
    high: { bg: isDark ? 'bg-red-500/15' : 'bg-red-50', text: 'text-red-500' },
    normal: { bg: isDark ? 'bg-zinc-500/15' : 'bg-zinc-100', text: isDark ? 'text-zinc-400' : 'text-zinc-600' },
    low: { bg: isDark ? 'bg-blue-500/15' : 'bg-blue-50', text: 'text-blue-500' },
  }

  const sourceLabels: Record<string, string> = {
    note: 'Sticky Note',
    checklist_item: 'Checklist',
    kanban_task: 'Kanban',
  }

  const recentBoards = data.boards.slice(0, 4)

  return (
    <div>
      {/* Welcome Banner */}
      <div className={`${cardBg} border ${cardBorder} rounded-2xl p-6 mb-6`}>
        <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
          Welcome back, {firstName}
        </h1>
        <p className={`text-sm ${mutedText}`}>{summary}</p>
      </div>

      {/* Quick Stats Row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'In Progress', value: stats.assigned, icon: Clock, alert: false },
          { label: 'Completed', value: stats.completed, icon: CheckCircle2, alert: false },
          { label: 'Overdue', value: stats.overdue, icon: AlertTriangle, alert: stats.overdue > 0 },
          { label: 'High Priority', value: stats.highPriority, icon: Flame, alert: stats.highPriority > 0 },
        ].map((s) => (
          <div key={s.label} className={`${cardBg} border ${s.alert ? 'border-red-500/40' : cardBorder} rounded-xl p-4 flex items-center gap-3`}>
            <s.icon size={16} className={s.alert ? 'text-red-500' : mutedText} />
            <div>
              <p className={`text-xl font-bold ${s.alert ? 'text-red-500' : isDark ? 'text-white' : 'text-zinc-900'}`}>{s.value}</p>
              <p className={`text-[11px] ${mutedText}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Two-column: Focus + Boards */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-6">
        {/* Today's Focus */}
        <div className={`${cardBg} border ${cardBorder} rounded-2xl p-5 lg:col-span-3`}>
          <h2 className={`text-sm font-semibold mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            Focus
          </h2>
          {upcomingTasks.length === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle2 size={28} className={`mx-auto mb-2 ${isDark ? 'text-zinc-600' : 'text-zinc-300'}`} />
              <p className={`text-sm ${mutedText}`}>No active tasks</p>
            </div>
          ) : (
            <div className="space-y-2">
              {upcomingTasks.map((task) => {
                const badge = priorityBadge[task.priority] || priorityBadge.normal
                const isOverdue = task.dueDate && new Date(task.dueDate).getTime() < Date.now()
                return (
                  <div
                    key={task._id}
                    className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
                      isDark ? 'hover:bg-zinc-700/30' : 'hover:bg-zinc-50'
                    }`}
                  >
                    <CircleDot size={14} className={priorityColors[task.priority] || mutedText} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                        {task.content || 'Untitled task'}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${badge.bg} ${badge.text}`}>
                          {task.priority}
                        </span>
                        <span className={`text-[10px] ${mutedText}`}>
                          {sourceLabels[task.sourceType] || task.sourceType}
                        </span>
                        {task.dueDate && (
                          <span className={`text-[10px] ${isOverdue ? 'text-red-500 font-medium' : mutedText}`}>
                            {isOverdue ? 'Overdue' : `Due ${formatRelativeTime(task.dueDate)}`}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent Boards */}
        <div className={`${cardBg} border ${cardBorder} rounded-2xl p-5 lg:col-span-2`}>
          <h2 className={`text-sm font-semibold mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            Recent Boards
          </h2>
          {recentBoards.length === 0 ? (
            <div className="py-8 text-center">
              <FolderKanban size={28} className={`mx-auto mb-2 ${isDark ? 'text-zinc-600' : 'text-zinc-300'}`} />
              <p className={`text-sm ${mutedText}`}>No boards yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentBoards.map((board) => (
                <div
                  key={board._id}
                  onClick={() => onOpenBoard(board.localBoardId)}
                  className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${
                    isDark ? 'hover:bg-zinc-700/30' : 'hover:bg-zinc-50'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isDark ? 'bg-blue-500/15' : 'bg-blue-50'
                  }`}>
                    <FolderKanban size={14} className={isDark ? 'text-blue-400' : 'text-blue-500'} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                      {board.title || 'Untitled'}
                    </p>
                    <p className={`text-[10px] ${mutedText}`}>
                      {formatRelativeTime(board.updatedAt)}
                    </p>
                  </div>
                  <ExternalLink size={12} className={isDark ? 'text-zinc-600' : 'text-zinc-400'} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className={`${cardBg} border ${cardBorder} rounded-2xl p-5 mb-6`}>
        <div className="flex items-center justify-between mb-2">
          <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>Overall Progress</h3>
          <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>{completionRate}%</span>
        </div>
        <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700' : 'bg-zinc-100'}`}>
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${completionRate}%` }}
          />
        </div>
        <p className={`text-xs mt-2 ${mutedText}`}>
          {stats.completed} of {stats.totalAssignments} tasks completed
        </p>
      </div>

      {/* Analytics toggle */}
      <button
        onClick={() => setShowAnalytics(!showAnalytics)}
        className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-colors mb-4 ${
          isDark ? 'text-zinc-400 hover:bg-zinc-800/50' : 'text-zinc-500 hover:bg-zinc-100'
        }`}
      >
        {showAnalytics ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        {showAnalytics ? 'Hide Analytics' : 'Show Analytics'}
      </button>

      {showAnalytics && (
        <div className="space-y-4">
          {/* Charts row: Timeline + Status doughnut */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className={`${cardBg} border ${cardBorder} rounded-2xl p-5 lg:col-span-2`}>
              <h3 className={`text-sm font-semibold mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Task Activity</h3>
              <div className="h-48">
                <Line
                  data={{
                    labels: charts.timeline.map(w => w.week),
                    datasets: [
                      {
                        label: 'Created',
                        data: charts.timeline.map(w => w.created),
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59,130,246,0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 3,
                      },
                      {
                        label: 'Completed',
                        data: charts.timeline.map(w => w.completed),
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16,185,129,0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 3,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: true, position: 'top', labels: { boxWidth: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11 }, color: isDark ? '#a1a1aa' : '#71717a' } } },
                    scales: {
                      x: { ticks: { color: isDark ? '#71717a' : '#a1a1aa', font: { size: 10 } }, grid: { display: false } },
                      y: { beginAtZero: true, ticks: { stepSize: 1, color: isDark ? '#71717a' : '#a1a1aa', font: { size: 10 } }, grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } },
                    },
                  }}
                />
              </div>
            </div>

            <div className={`${cardBg} border ${cardBorder} rounded-2xl p-5`}>
              <h3 className={`text-sm font-semibold mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Task Status</h3>
              <div className="h-48 flex items-center justify-center">
                <Doughnut
                  data={{
                    labels: ['Draft', 'In Progress', 'Completed'],
                    datasets: [{
                      data: [stats.draft, stats.assigned, stats.completed],
                      backgroundColor: ['#71717a', '#f59e0b', '#10b981'],
                      borderWidth: 0,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true, pointStyle: 'circle', font: { size: 10 }, color: isDark ? '#a1a1aa' : '#71717a', padding: 12 } } },
                  }}
                />
              </div>
            </div>
          </div>

          {/* Charts row 2: Priority + Sources */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${cardBg} border ${cardBorder} rounded-2xl p-5`}>
              <h3 className={`text-sm font-semibold mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Priority Distribution</h3>
              <div className="h-48 flex items-center justify-center">
                <Doughnut
                  data={{
                    labels: ['Low', 'Normal', 'High'],
                    datasets: [{
                      data: [charts.priorityDistribution.low, charts.priorityDistribution.normal, charts.priorityDistribution.high],
                      backgroundColor: ['#60a5fa', '#a1a1aa', '#f87171'],
                      borderWidth: 0,
                      hoverOffset: 6,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '65%',
                    plugins: {
                      legend: { position: 'bottom', labels: { boxWidth: 10, usePointStyle: true, pointStyle: 'circle', font: { size: 10 }, color: isDark ? '#a1a1aa' : '#71717a', padding: 12 } },
                    },
                  }}
                />
              </div>
            </div>

            <div className={`${cardBg} border ${cardBorder} rounded-2xl p-5`}>
              <h3 className={`text-sm font-semibold mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Task Sources</h3>
              <div className="h-48">
                <Bar
                  data={{
                    labels: ['Sticky Notes', 'Checklists', 'Kanban'],
                    datasets: [{
                      label: 'Tasks',
                      data: [charts.sourceTypeDistribution.note, charts.sourceTypeDistribution.checklist_item, charts.sourceTypeDistribution.kanban_task],
                      backgroundColor: [isDark ? 'rgba(251,191,36,0.3)' : 'rgba(251,191,36,0.6)', isDark ? 'rgba(56,189,248,0.3)' : 'rgba(56,189,248,0.6)', isDark ? 'rgba(167,139,250,0.3)' : 'rgba(167,139,250,0.6)'],
                      borderColor: ['#fbbf24', '#38bdf8', '#a78bfa'],
                      borderWidth: 1,
                      borderRadius: 6,
                    }],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                    },
                    scales: {
                      x: { ticks: { color: isDark ? '#71717a' : '#a1a1aa', font: { size: 10 } }, grid: { display: false } },
                      y: { beginAtZero: true, ticks: { stepSize: 1, color: isDark ? '#71717a' : '#a1a1aa', font: { size: 10 } }, grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' } },
                    },
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
