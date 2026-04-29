'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Filter,
  ArrowUpDown,
  Loader2,
  ListTodo,
  CheckSquare,
  LayoutGrid,
  Bell,
  Flame,
  RefreshCw,
  Star,
  Flag,
  ChevronDown,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface TaskItem {
  itemId: string
  parentId: string
  parentType: 'checklist' | 'kanban' | 'reminder'
  parentTitle: string
  text: string
  completed: boolean
  dueDate: string | null
  priority?: string
  columnId?: string
  columnTitle?: string
  availableColumns?: { id: string; title: string }[] | null
  assignedTo?: string
  boardId: string
  boardTitle: string
  source: 'board' | 'assignment'
}

interface TaskSummary {
  total: number
  incomplete: number
  completed: number
  overdue: number
  dueSoon: number
}

type FilterOption = 'all' | 'incomplete' | 'completed' | 'overdue' | 'due-soon'
type SortOption = 'due-date' | 'board' | 'type' | 'recent'

const FILTER_OPTIONS: { id: FilterOption; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'incomplete', label: 'Incomplete' },
  { id: 'completed', label: 'Completed' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'due-soon', label: 'Due soon' },
]

const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'due-date', label: 'Due date' },
  { id: 'board', label: 'Board' },
  { id: 'type', label: 'Type' },
  { id: 'recent', label: 'Recent' },
]

const TYPE_ICONS: Record<string, typeof CheckSquare> = {
  checklist: CheckSquare,
  kanban: LayoutGrid,
  reminder: Bell,
}

const TYPE_LABELS: Record<string, string> = {
  checklist: 'Checklist',
  kanban: 'Kanban',
  reminder: 'Reminder',
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMs < 0) {
    const absDays = Math.abs(diffDays)
    if (absDays === 0) return 'Overdue today'
    if (absDays === 1) return 'Overdue by 1 day'
    return `Overdue by ${absDays} days`
  }

  if (diffDays === 0) {
    if (diffHours < 1) return `${diffMins}m left`
    return `${diffHours}h left`
  }
  if (diffDays === 1) return 'Tomorrow'
  if (diffDays < 7) return `${diffDays} days left`

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function MyTasksTab({
  isDark,
  onOpenBoard,
  orgId,
}: {
  isDark: boolean
  onOpenBoard: (boardId: string) => void
  orgId?: string
}) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [summary, setSummary] = useState<TaskSummary>({ total: 0, incomplete: 0, completed: 0, overdue: 0, dueSoon: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<FilterOption>('incomplete')
  const [sort, setSort] = useState<SortOption>('due-date')
  const [showFilterMenu, setShowFilterMenu] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [columnDropdownId, setColumnDropdownId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())

  const cardBg = isDark ? 'bg-zinc-800/50' : 'bg-white'
  const cardBorder = isDark ? 'border-zinc-700/50' : 'border-zinc-200'
  const mutedText = isDark ? 'text-zinc-400' : 'text-zinc-500'

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ filter, sort })
      if (orgId) params.set('orgId', orgId)
      const res = await fetch(`/api/dashboard/my-tasks?${params}`)
      if (!res.ok) return
      const json = await res.json()
      setTasks(json.tasks || [])
      setSummary(json.summary || { total: 0, incomplete: 0, completed: 0, overdue: 0, dueSoon: 0 })
    } catch {
      // silent
    } finally {
      setIsLoading(false)
    }
  }, [filter, sort, orgId])

  useEffect(() => {
    setIsLoading(true)
    fetchTasks()
  }, [fetchTasks])

  // Poll every 30s
  useEffect(() => {
    const interval = setInterval(() => fetchTasks(), 30_000)
    return () => clearInterval(interval)
  }, [fetchTasks])

  // Close menus on outside click
  useEffect(() => {
    const handleClick = () => {
      setShowFilterMenu(false)
      setShowSortMenu(false)
      setColumnDropdownId(null)
    }
    if (showFilterMenu || showSortMenu || columnDropdownId) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [showFilterMenu, showSortMenu, columnDropdownId])

  const handleToggle = async (task: TaskItem) => {
    const key = `${task.boardId}-${task.itemId}`
    setTogglingId(key)
    try {
      const res = await fetch('/api/dashboard/my-tasks/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle',
          source: task.source,
          itemId: task.itemId,
          boardId: task.boardId,
          parentType: task.parentType,
          text: task.text,
          completed: task.completed,
          dueDate: task.dueDate,
          priority: task.priority,
          columnId: task.columnId,
          columnTitle: task.columnTitle,
          availableColumns: task.availableColumns,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        // Optimistic update
        setTasks((prev) =>
          prev.map((t) =>
            t.boardId === task.boardId && t.itemId === task.itemId
              ? { ...t, completed: data.completed, source: 'assignment' }
              : t
          )
        )
        // Update summary
        setSummary((prev) => {
          const delta = data.completed ? 1 : -1
          return {
            ...prev,
            completed: prev.completed + delta,
            incomplete: prev.incomplete - delta,
          }
        })
      }
    } catch { /* silent */ } finally {
      setTogglingId(null)
    }
  }

  const handleMoveColumn = async (task: TaskItem, newColumnId: string, newColumnTitle: string) => {
    const key = `${task.boardId}-${task.itemId}`
    setMovingId(key)
    setColumnDropdownId(null)
    try {
      const res = await fetch('/api/dashboard/my-tasks/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'move-column',
          source: task.source,
          itemId: task.itemId,
          boardId: task.boardId,
          parentType: task.parentType,
          text: task.text,
          completed: task.completed,
          columnId: newColumnId,
          columnTitle: newColumnTitle,
          availableColumns: task.availableColumns,
          dueDate: task.dueDate,
          priority: task.priority,
        }),
      })
      if (res.ok) {
        setTasks((prev) =>
          prev.map((t) =>
            t.boardId === task.boardId && t.itemId === task.itemId
              ? { ...t, columnId: newColumnId, columnTitle: newColumnTitle, source: 'assignment' }
              : t
          )
        )
      }
    } catch { /* silent */ } finally {
      setMovingId(null)
    }
  }

  const handleBulkComplete = async () => {
    const ids = Array.from(selectedIds)
    for (const id of ids) {
      const task = tasks.find((t) => `${t.boardId}-${t.itemId}` === id)
      if (task && !task.completed) await handleToggle(task)
    }
    setSelectedIds(new Set())
  }

  const toggleSelect = (key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const toggleStar = (key: string) => {
    setStarredIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = date.getTime() - now.getTime()
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
    if (days < 0) return { text: `${Math.abs(days)}d overdue`, overdue: true }
    if (days === 0) return { text: 'Today', overdue: false }
    if (days === 1) return { text: 'Tomorrow', overdue: false }
    if (days <= 7) return { text: `${days}d`, overdue: false }
    return { text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), overdue: false }
  }

  const allTaskKeys = tasks.map((t) => `${t.boardId}-${t.itemId}`)
  const allSelected = allTaskKeys.length > 0 && allTaskKeys.every((k) => selectedIds.has(k))
  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(allTaskKeys))
  }
  const incompleteSelected = Array.from(selectedIds).filter((k) => {
    const t = tasks.find((t) => `${t.boardId}-${t.itemId}` === k)
    return t && !t.completed
  }).length

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-blue-500" />
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>My Tasks</h1>
          <p className={`text-sm mt-1 ${mutedText}`}>
            All your tasks across every board — checklists, kanban, and reminders.
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total', value: summary.total, icon: ListTodo, color: '' },
          { label: 'Incomplete', value: summary.incomplete, icon: Circle, color: '' },
          { label: 'Completed', value: summary.completed, icon: CheckCircle2, color: 'text-emerald-500' },
          { label: 'Overdue', value: summary.overdue, icon: AlertTriangle, color: summary.overdue > 0 ? 'text-red-500' : '' },
          { label: 'Due soon', value: summary.dueSoon, icon: Flame, color: summary.dueSoon > 0 ? 'text-amber-500' : '' },
        ].map((s) => (
          <div key={s.label} className={`${cardBg} border ${cardBorder} rounded-xl p-3 flex items-center gap-3`}>
            <s.icon size={15} className={s.color || mutedText} />
            <div>
              <p className={`text-lg font-bold ${s.color || (isDark ? 'text-white' : 'text-zinc-900')}`}>{s.value}</p>
              <p className={`text-[10px] ${mutedText}`}>{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter & Sort Controls */}
      <div className="flex items-center gap-2 mb-4">
        {/* Filter dropdown */}
        <div className="relative">
          <button
            onClick={() => { setShowFilterMenu(!showFilterMenu); setShowSortMenu(false) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              isDark ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-700/50' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            <Filter size={13} />
            {FILTER_OPTIONS.find(f => f.id === filter)?.label}
          </button>
          {showFilterMenu && (
            <div className={`absolute top-full left-0 mt-1 py-1 rounded-xl border shadow-lg z-20 min-w-[140px] ${
              isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
            }`}>
              {FILTER_OPTIONS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => { setFilter(f.id); setShowFilterMenu(false) }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                    filter === f.id
                      ? 'text-blue-500 font-medium'
                      : isDark ? 'text-zinc-300 hover:bg-zinc-700/50' : 'text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort dropdown */}
        <div className="relative">
          <button
            onClick={() => { setShowSortMenu(!showSortMenu); setShowFilterMenu(false) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              isDark ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-700/50' : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            <ArrowUpDown size={13} />
            {SORT_OPTIONS.find(s => s.id === sort)?.label}
          </button>
          {showSortMenu && (
            <div className={`absolute top-full left-0 mt-1 py-1 rounded-xl border shadow-lg z-20 min-w-[130px] ${
              isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
            }`}>
              {SORT_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSort(s.id); setShowSortMenu(false) }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                    sort === s.id
                      ? 'text-blue-500 font-medium'
                      : isDark ? 'text-zinc-300 hover:bg-zinc-700/50' : 'text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Toolbar */}
      {tasks.length > 0 && (
        <div className={`flex items-center gap-3 mb-3 px-1`}>
          <button
            onClick={toggleSelectAll}
            className={`flex items-center gap-1.5 text-xs ${mutedText} hover:opacity-80 transition-opacity`}
          >
            {allSelected ? <CheckCircle2 size={14} className="text-blue-500" /> : <Circle size={14} />}
            <span>{allSelected ? 'Deselect all' : 'Select all'}</span>
          </button>
          <button
            onClick={() => fetchTasks()}
            className={`flex items-center gap-1 text-xs ${mutedText} hover:opacity-80 transition-opacity`}
          >
            <RefreshCw size={12} />
            Refresh
          </button>
          {incompleteSelected > 0 && (
            <button
              onClick={handleBulkComplete}
              className="flex items-center gap-1 text-xs text-emerald-500 font-medium hover:opacity-80 transition-opacity"
            >
              <CheckCircle2 size={12} />
              Complete {incompleteSelected} selected
            </button>
          )}
        </div>
      )}

      {/* Task List */}
      {tasks.length === 0 ? (
        <div className={`${cardBg} border ${cardBorder} rounded-2xl py-16 text-center`}>
          <ListTodo size={36} className={`mx-auto mb-3 ${isDark ? 'text-zinc-600' : 'text-zinc-300'}`} />
          <p className={`text-sm font-medium ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            {filter === 'all' ? 'No tasks yet' : `No ${filter.replace('-', ' ')} tasks`}
          </p>
          <p className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            Add items to checklists, kanban boards, or reminders on your boards.
          </p>
        </div>
      ) : (
        <div className={`${cardBg} border ${cardBorder} rounded-2xl`}>
          <AnimatePresence initial={false}>
            {tasks.map((task) => {
              const key = `${task.boardId}-${task.itemId}`
              const TypeIcon = TYPE_ICONS[task.parentType] || CheckSquare
              const isOverdue = !task.completed && task.dueDate && new Date(task.dueDate).getTime() < Date.now()
              const isToggling = togglingId === key
              const isSelected = selectedIds.has(key)
              const isStarred = starredIds.has(key)
              const dueFmt = task.dueDate ? formatDate(task.dueDate) : null

              return (
                <motion.div
                  key={key}
                  layout
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className={`flex items-center gap-3 px-4 py-3 border-b last:border-b-0 ${
                    isDark ? 'border-zinc-700/50' : 'border-zinc-100'
                  } ${isSelected ? (isDark ? 'bg-blue-500/10' : 'bg-blue-50/60') : ''} transition-colors group`}
                >
                  {/* Select checkbox */}
                  <button
                    onClick={() => toggleSelect(key)}
                    className={`flex-shrink-0 ${mutedText} hover:text-blue-500 transition-colors`}
                  >
                    {isSelected ? (
                      <CheckCircle2 size={14} className="text-blue-500" />
                    ) : (
                      <Circle size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </button>

                  {/* Toggle completion circle */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggle(task) }}
                    disabled={isToggling}
                    className="flex-shrink-0 mt-0.5"
                  >
                    {isToggling ? (
                      <Loader2 size={16} className="animate-spin text-blue-500" />
                    ) : task.completed ? (
                      <CheckCircle2 size={16} className="text-emerald-500 hover:text-emerald-400 transition-colors" />
                    ) : (
                      <Circle size={16} className={`${
                        isOverdue ? 'text-red-400' : mutedText
                      } hover:text-emerald-500 transition-colors`} />
                    )}
                  </button>

                  {/* Content — click opens the board */}
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => onOpenBoard(task.boardId)}
                  >
                    <p className={`text-sm ${
                      task.completed
                        ? `line-through ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`
                        : isDark ? 'text-white' : 'text-zinc-900'
                    }`}>
                      {task.text || 'Untitled'}
                    </p>

                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {/* Type badge */}
                      <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                        isDark ? 'bg-zinc-700/50 text-zinc-400' : 'bg-zinc-100 text-zinc-500'
                      }`}>
                        <TypeIcon size={10} />
                        {TYPE_LABELS[task.parentType] || task.parentType}
                      </span>

                      {/* Priority flag */}
                      {task.priority && (
                        <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                          task.priority === 'high'
                            ? isDark ? 'bg-red-500/15 text-red-400' : 'bg-red-50 text-red-500'
                            : task.priority === 'medium'
                              ? isDark ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-50 text-amber-600'
                              : isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-50 text-blue-500'
                        }`}>
                          <Flag size={9} />
                          {task.priority}
                        </span>
                      )}

                      {/* Column static badge (inline, non-interactive) */}
                      {task.parentType === 'kanban' && task.columnTitle && (
                        <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                          isDark ? 'bg-zinc-700/50 text-zinc-400' : 'bg-zinc-100 text-zinc-500'
                        }`}>
                          <LayoutGrid size={9} />
                          {task.columnTitle}
                        </span>
                      )}

                      {/* Due date */}
                      {dueFmt && (
                        <span className={`inline-flex items-center gap-0.5 text-[10px] ${
                          dueFmt.overdue ? 'text-red-500 font-medium' : mutedText
                        }`}>
                          <Clock size={10} />
                          {dueFmt.text}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Star */}
                  <button
                    onClick={() => toggleStar(key)}
                    className={`flex-shrink-0 transition-colors ${
                      isStarred ? 'text-amber-400' : `${mutedText} opacity-0 group-hover:opacity-100`
                    }`}
                  >
                    <Star size={14} fill={isStarred ? 'currentColor' : 'none'} />
                  </button>

                  {/* Kanban column dropdown — right side */}
                  {task.parentType === 'kanban' && task.columnTitle && task.availableColumns && task.availableColumns.length > 1 && (
                    <div className="relative flex-shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setColumnDropdownId(columnDropdownId === key ? null : key)
                        }}
                        disabled={movingId === key}
                        className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${
                          isDark
                            ? 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/50'
                            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                        }`}
                      >
                        {movingId === key ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : (
                          <LayoutGrid size={10} />
                        )}
                        {task.columnTitle}
                        <ChevronDown size={10} />
                      </button>
                      {columnDropdownId === key && (
                        <div
                          className={`absolute top-full right-0 mt-1 py-1 rounded-xl border shadow-lg z-50 min-w-[130px] ${
                            isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {task.availableColumns.map((col) => (
                            <button
                              key={col.id}
                              onClick={() => handleMoveColumn(task, col.id, col.title)}
                              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                                col.title === task.columnTitle
                                  ? 'text-blue-500 font-medium'
                                  : isDark ? 'text-zinc-300 hover:bg-zinc-700/50' : 'text-zinc-600 hover:bg-zinc-50'
                              }`}
                            >
                              {col.title}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Board & parent context */}
                  <div className="text-right flex-shrink-0 ml-1 hidden sm:block">
                    <p className={`text-[11px] font-medium ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`}>
                      {task.boardTitle}
                    </p>
                    <p className={`text-[10px] ${mutedText}`}>
                      {task.parentTitle}
                    </p>
                  </div>

                  {/* Done action for incomplete tasks — always visible */}
                  {!task.completed && !isToggling && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleToggle(task) }}
                      className={`flex-shrink-0 text-[10px] font-medium px-2 py-1 rounded-md transition-all ${
                        isDark
                          ? 'text-emerald-400 hover:bg-emerald-500/15'
                          : 'text-emerald-600 hover:bg-emerald-50'
                      }`}
                    >
                      Done
                    </button>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
