'use client'

import { useMemo } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import type { DashboardData } from './types'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
)

export default function DashboardCharts({
  charts,
  isDark,
  assignmentStats,
}: {
  charts: DashboardData['charts']
  isDark: boolean
  assignmentStats: DashboardData['assignmentStats']
}) {
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'
  const textColor = isDark ? '#a1a1aa' : '#71717a'

  const tooltipStyle = {
    backgroundColor: isDark ? '#27272a' : '#fff',
    titleColor: isDark ? '#fafafa' : '#18181b',
    bodyColor: isDark ? '#a1a1aa' : '#52525b',
    borderColor: isDark ? '#3f3f46' : '#e4e4e7',
    borderWidth: 1,
    padding: 10,
    cornerRadius: 10,
    boxPadding: 4,
  } as const

  /* ── Status Doughnut ── */
  const statusData = useMemo(() => ({
    labels: ['Draft', 'Assigned', 'Completed'],
    datasets: [{
      data: [assignmentStats.draft, assignmentStats.assigned, assignmentStats.completed],
      backgroundColor: ['#a1a1aa', '#f59e0b', '#10b981'],
      borderWidth: 0,
      hoverOffset: 6,
    }],
  }), [assignmentStats])

  /* ── Priority Doughnut ── */
  const priorityData = useMemo(() => ({
    labels: ['Low', 'Normal', 'High'],
    datasets: [{
      data: [charts.priorityDistribution.low, charts.priorityDistribution.normal, charts.priorityDistribution.high],
      backgroundColor: ['#60a5fa', '#a78bfa', '#f87171'],
      borderWidth: 0,
      hoverOffset: 6,
    }],
  }), [charts.priorityDistribution])

  /* ── Source Type Doughnut ── */
  const sourceTypeData = useMemo(() => ({
    labels: ['Sticky Notes', 'Checklist Items', 'Kanban Tasks'],
    datasets: [{
      data: [charts.sourceTypeDistribution.note, charts.sourceTypeDistribution.checklist_item, charts.sourceTypeDistribution.kanban_task],
      backgroundColor: ['#facc15', '#34d399', '#818cf8'],
      borderWidth: 0,
      hoverOffset: 6,
    }],
  }), [charts.sourceTypeDistribution])

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: { legend: { position: 'bottom' as const, labels: { color: textColor, padding: 12, usePointStyle: true, pointStyleWidth: 8, font: { size: 11 } } }, tooltip: tooltipStyle },
  }

  /* ── Board Task Breakdown (stacked bar) ── */
  const boardBreakdownData = useMemo(() => ({
    labels: charts.boardTaskBreakdown.map(b => b.boardTitle.length > 14 ? b.boardTitle.slice(0, 14) + '…' : b.boardTitle),
    datasets: [
      { label: 'Draft', data: charts.boardTaskBreakdown.map(b => b.draft), backgroundColor: '#a1a1aa' },
      { label: 'Assigned', data: charts.boardTaskBreakdown.map(b => b.assigned), backgroundColor: '#f59e0b' },
      { label: 'Completed', data: charts.boardTaskBreakdown.map(b => b.completed), backgroundColor: '#10b981' },
    ],
  }), [charts.boardTaskBreakdown])

  const boardBreakdownOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { stacked: true, grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } },
      y: { stacked: true, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } }, beginAtZero: true },
    },
    plugins: { legend: { position: 'bottom' as const, labels: { color: textColor, padding: 12, usePointStyle: true, pointStyleWidth: 8, font: { size: 11 } } }, tooltip: tooltipStyle },
  }

  /* ── Timeline (line chart) ── */
  const timelineData = useMemo(() => ({
    labels: charts.timeline.map(t => t.week),
    datasets: [
      {
        label: 'Created',
        data: charts.timeline.map(t => t.created),
        borderColor: '#60a5fa',
        backgroundColor: 'rgba(96,165,250,0.1)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 5,
      },
      {
        label: 'Completed',
        data: charts.timeline.map(t => t.completed),
        borderColor: '#34d399',
        backgroundColor: 'rgba(52,211,153,0.1)',
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 5,
      },
    ],
  }), [charts.timeline])

  const timelineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } },
      y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } }, beginAtZero: true },
    },
    plugins: { legend: { position: 'bottom' as const, labels: { color: textColor, padding: 12, usePointStyle: true, pointStyleWidth: 8, font: { size: 11 } } }, tooltip: tooltipStyle },
  }

  /* ── Member Workload (horizontal bar) ── */
  const workloadData = useMemo(() => ({
    labels: charts.memberWorkload.map(m => m.name),
    datasets: [
      { label: 'Assigned', data: charts.memberWorkload.map(m => m.assigned), backgroundColor: '#f59e0b' },
      { label: 'Completed', data: charts.memberWorkload.map(m => m.completed), backgroundColor: '#10b981' },
    ],
  }), [charts.memberWorkload])

  const workloadOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y' as const,
    scales: {
      x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } }, beginAtZero: true },
      y: { grid: { display: false }, ticks: { color: textColor, font: { size: 11 } } },
    },
    plugins: { legend: { position: 'bottom' as const, labels: { color: textColor, padding: 12, usePointStyle: true, pointStyleWidth: 8, font: { size: 11 } } }, tooltip: tooltipStyle },
  }

  const cardClass = `rounded-2xl border p-5 ${isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'}`
  const headingClass = `font-semibold text-sm mb-4 ${isDark ? 'text-white' : 'text-zinc-900'}`

  return (
    <div className="mb-8 space-y-6">
      {/* Row 1 — three doughnuts */}
      <div className="grid grid-cols-3 gap-4">
        <div className={cardClass}>
          <h3 className={headingClass}>Task Status</h3>
          <div className="h-52"><Doughnut data={statusData} options={doughnutOptions} /></div>
        </div>
        <div className={cardClass}>
          <h3 className={headingClass}>Priority Breakdown</h3>
          <div className="h-52"><Doughnut data={priorityData} options={doughnutOptions} /></div>
        </div>
        <div className={cardClass}>
          <h3 className={headingClass}>Source Types</h3>
          <div className="h-52"><Doughnut data={sourceTypeData} options={doughnutOptions} /></div>
        </div>
      </div>

      {/* Row 2 — timeline line chart */}
      <div className={cardClass}>
        <h3 className={headingClass}>Assignment Timeline</h3>
        <div className="h-64"><Line data={timelineData} options={timelineOptions} /></div>
      </div>

      {/* Row 3 — board breakdown + workload */}
      <div className="grid grid-cols-2 gap-4">
        {charts.boardTaskBreakdown.length > 0 && (
          <div className={cardClass}>
            <h3 className={headingClass}>Tasks by Board</h3>
            <div className="h-64"><Bar data={boardBreakdownData} options={boardBreakdownOptions} /></div>
          </div>
        )}
        {charts.memberWorkload.length > 0 && (
          <div className={cardClass}>
            <h3 className={headingClass}>Member Workload</h3>
            <div className="h-64"><Bar data={workloadData} options={workloadOptions} /></div>
          </div>
        )}
      </div>
    </div>
  )
}
