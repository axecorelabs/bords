'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  CheckCircle2,
  Flag,
  Loader2,
  Inbox,
  ChevronDown,
  CheckSquare,
  LayoutGrid,
  RefreshCw,
  Star,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface TaskItem {
  _id: string
  bordId: string | null
  bordTitle: string | null
  sourceType: string
  sourceId: string
  content: string
  priority: 'low' | 'normal' | 'high'
  dueDate: string | null
  executionNote: string | null
  status: 'assigned' | 'completed'
  completedAt: string | null
  createdAt: string
  columnId: string | null
  columnTitle: string | null
  availableColumns: { id: string; title: string }[]
  contextType?: 'personal' | 'organization'
  assigner?: { firstName: string; lastName: string }
}

interface OrgTaskGroup {
  organization: { _id: string; name: string }
  tasks: TaskItem[]
}

type FilterTab = 'all' | 'checklist' | 'kanban' | 'completed'

export default function InboxTab({
  isDark,
  orgId,
}: {
  isDark: boolean
  orgId: string
}) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [completingId, setCompletingId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [columnDropdownId, setColumnDropdownId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterTab>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set())

  const fetchTasks = useCallback(async () => {
    try {
      setIsLoading(true)
      setFetchError(null)
      const res = await fetch('/api/execution/tasks')
      if (!res.ok) throw new Error('Failed to load tasks')
      const data = await res.json()
      const orgGroup = (data.tasksByOrganization || []).find(
        (g: OrgTaskGroup) => g.organization._id === orgId
      )
      setTasks(orgGroup?.tasks || [])
    } catch (err: any) {
      setFetchError(err.message)
    } finally {
      setIsLoading(false)
    }
  }, [orgId])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  useEffect(() => {
    const handleClick = () => setColumnDropdownId(null)
    if (columnDropdownId) {
      document.addEventListener('click', handleClick)
      return () => document.removeEventListener('click', handleClick)
    }
  }, [columnDropdownId])

  const handleComplete = async (taskId: string) => {
    setCompletingId(taskId)
    try {
      const res = await fetch(`/api/execution/tasks/${taskId}/complete`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setTasks((prev) =>
          prev.map((t) =>
            t._id === taskId
              ? { ...t, status: data.task?.status || 'completed', completedAt: data.task?.completedAt || null }
              : t
          )
        )
      }
    } catch { /* silent */ } finally {
      setCompletingId(null)
    }
  }

  const handleMoveColumn = async (taskId: string, newColumnId: string, newColumnTitle: string) => {
    setMovingId(taskId)
    setColumnDropdownId(null)
    try {
      const res = await fetch(`/api/execution/tasks/${taskId}/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columnId: newColumnId, columnTitle: newColumnTitle }),
      })
      if (res.ok) {
        setTasks((prev) =>
          prev.map((t) =>
            t._id === taskId ? { ...t, columnId: newColumnId, columnTitle: newColumnTitle } : t
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
      await handleComplete(id)
    }
    setSelectedIds(new Set())
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleStar = (id: string) => {
    setStarredIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
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

  const formatTimestamp = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const isYesterday = date.toDateString() === yesterday.toDateString()
    if (isToday) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    if (isYesterday) return 'Yesterday'
    if (now.getFullYear() === date.getFullYear()) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const filterTask = (task: TaskItem): boolean => {
    switch (filter) {
      case 'checklist': return task.sourceType === 'checklist_item' && task.status === 'assigned'
      case 'kanban': return task.sourceType === 'kanban_task' && task.status === 'assigned'
      case 'completed': return task.status === 'completed'
      default: return task.status === 'assigned'
    }
  }

  const pendingTasks = tasks.filter((t) => t.status === 'assigned')
  const checklistCount = tasks.filter((t) => t.sourceType === 'checklist_item' && t.status === 'assigned').length
  const kanbanCount = tasks.filter((t) => t.sourceType === 'kanban_task' && t.status === 'assigned').length
  const completedCount = tasks.filter((t) => t.status === 'completed').length

  const tabs: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all', label: 'Inbox', count: pendingTasks.length },
    { key: 'checklist', label: 'Checklists', count: checklistCount },
    { key: 'kanban', label: 'Kanban', count: kanbanCount },
    { key: 'completed', label: 'Done', count: completedCount },
  ]

  const filteredTasks = tasks.filter(filterTask)
  const sorted = [...filteredTasks].sort((a, b) => {
    const aStarred = starredIds.has(a._id) ? 0 : 1
    const bStarred = starredIds.has(b._id) ? 0 : 1
    if (aStarred !== bStarred) return aStarred - bStarred
    const priOrder: Record<string, number> = { high: 0, normal: 1, low: 2 }
    const aPri = priOrder[a.priority] ?? 1
    const bPri = priOrder[b.priority] ?? 1
    if (aPri !== bPri) return aPri - bPri
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const allFilteredIds = sorted.map(t => t._id)
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedIds.has(id))
  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(allFilteredIds))
  }

  return (
    <div>
      {/* Category pills */}
      <div className="flex items-center gap-1.5 mb-4">
        {tabs.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => { setFilter(key); setSelectedIds(new Set()) }}
            className={`px-3.5 py-1.5 text-[13px] font-medium rounded-full transition-colors ${
              filter === key
                ? isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-50 text-blue-600'
                : isDark ? 'hover:bg-zinc-800 text-zinc-500' : 'hover:bg-zinc-100 text-zinc-500'
            }`}
          >
            {label}
            {count > 0 && (
              <span className={`ml-1.5 text-[11px] ${
                filter === key
                  ? isDark ? 'text-blue-400/70' : 'text-blue-500/70'
                  : isDark ? 'text-zinc-600' : 'text-zinc-400'
              }`}>{count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-t-xl border border-b-0 ${
        isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-zinc-50/80 border-zinc-200'
      }`}>
        <button onClick={toggleSelectAll} className={`p-1 rounded transition-colors ${isDark ? 'hover:bg-zinc-700' : 'hover:bg-zinc-200'}`}>
          <div className={`w-[15px] h-[15px] rounded-[3px] border-[1.5px] flex items-center justify-center transition-colors ${
            allSelected ? 'bg-blue-500 border-blue-500' : isDark ? 'border-zinc-600' : 'border-zinc-300'
          }`}>
            {allSelected && <CheckCircle2 size={9} className="text-white" />}
          </div>
        </button>
        <button
          onClick={fetchTasks}
          className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300' : 'text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600'}`}
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
        {selectedIds.size > 0 && (
          <>
            <div className={`w-px h-4 ${isDark ? 'bg-zinc-700' : 'bg-zinc-300'}`} />
            <button
              onClick={handleBulkComplete}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                isDark ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-emerald-600 hover:bg-emerald-50'
              }`}
            >
              <CheckCircle2 size={13} />
              Complete ({selectedIds.size})
            </button>
          </>
        )}
        <div className="flex-1" />
        <span className={`text-[11px] ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
          {sorted.length} of {tasks.length}
        </span>
      </div>

      {/* Task list */}
      <div className={`rounded-b-xl border overflow-hidden ${isDark ? 'border-zinc-700/50' : 'border-zinc-200'}`}>
        {isLoading ? (
          <div className={`flex items-center justify-center py-20 ${isDark ? 'bg-zinc-800/30' : 'bg-white'}`}>
            <Loader2 size={24} className="animate-spin text-blue-500" />
          </div>
        ) : fetchError ? (
          <div className={`text-center py-20 ${isDark ? 'bg-zinc-800/30' : 'bg-white'}`}>
            <p className={`text-sm mb-3 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>{fetchError}</p>
            <button onClick={fetchTasks} className="text-blue-500 hover:underline text-sm">Try again</button>
          </div>
        ) : sorted.length === 0 ? (
          <div className={`text-center py-20 ${isDark ? 'bg-zinc-800/30' : 'bg-white'}`}>
            <Inbox size={36} className={`mx-auto mb-3 ${isDark ? 'text-zinc-700' : 'text-zinc-300'}`} />
            <p className={`text-sm font-medium ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
              {filter === 'completed' ? 'No completed tasks' : filter === 'checklist' ? 'No checklist tasks' : filter === 'kanban' ? 'No kanban tasks' : 'All caught up!'}
            </p>
            <p className={`text-xs mt-1 ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
              Tasks assigned to you will appear here
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {sorted.map((task) => {
              const isCompleted = task.status === 'completed'
              const isCompleting = completingId === task._id
              const isMoving = movingId === task._id
              const isSelected = selectedIds.has(task._id)
              const isStarred = starredIds.has(task._id)
              const isKanban = task.sourceType === 'kanban_task'
              const hasColumns = isKanban && task.availableColumns?.length > 0
              const dueDateInfo = task.dueDate ? formatDate(task.dueDate) : null
              const senderName = task.assigner
                ? `${task.assigner.firstName}${task.assigner.lastName ? ` ${task.assigner.lastName.charAt(0)}.` : ''}`
                : 'System'
              const senderInitial = task.assigner?.firstName?.charAt(0)?.toUpperCase() || 'S'

              return (
                <motion.div
                  key={task._id}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`group flex items-center border-b transition-colors cursor-default ${
                    isSelected
                      ? isDark ? 'bg-blue-500/8 border-zinc-700/30' : 'bg-blue-50/60 border-zinc-100'
                      : isCompleted
                        ? isDark ? 'bg-zinc-900/30 border-zinc-700/30' : 'bg-zinc-50/50 border-zinc-100'
                        : isDark ? 'border-zinc-700/30 hover:bg-zinc-800/50' : 'border-zinc-100 hover:bg-stone-50'
                  } last:border-b-0`}
                >
                  {/* Select + star */}
                  <div className="flex items-center gap-0.5 pl-3 pr-1 py-2.5 flex-shrink-0">
                    <button onClick={() => toggleSelect(task._id)} className="p-0.5">
                      <div className={`w-[15px] h-[15px] rounded-[3px] border-[1.5px] flex items-center justify-center transition-colors ${
                        isSelected ? 'bg-blue-500 border-blue-500' : isDark ? 'border-zinc-600 group-hover:border-zinc-500' : 'border-zinc-300 group-hover:border-zinc-400'
                      }`}>
                        {isSelected && <CheckCircle2 size={9} className="text-white" />}
                      </div>
                    </button>
                    <button
                      onClick={() => toggleStar(task._id)}
                      className={`p-0.5 transition-colors ${
                        isStarred ? 'text-amber-400' : isDark ? 'text-zinc-700 hover:text-amber-400/60' : 'text-zinc-300 hover:text-amber-400/60'
                      }`}
                    >
                      <Star size={14} fill={isStarred ? 'currentColor' : 'none'} />
                    </button>
                  </div>

                  {/* Sender avatar */}
                  <div className="flex-shrink-0 pr-2.5">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold ${
                      isCompleted
                        ? isDark ? 'bg-zinc-800 text-zinc-600' : 'bg-zinc-100 text-zinc-400'
                        : isDark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'
                    }`}>
                      {senderInitial}
                    </div>
                  </div>

                  {/* Main row: sender | content — snippet | labels | date */}
                  <div className="flex-1 min-w-0 flex items-center gap-3 py-2.5 pr-3">
                    <span className={`w-24 flex-shrink-0 text-[13px] truncate ${
                      isCompleted
                        ? isDark ? 'text-zinc-600' : 'text-zinc-400'
                        : task.priority === 'high'
                          ? isDark ? 'text-white font-semibold' : 'text-zinc-900 font-semibold'
                          : isDark ? 'text-zinc-200 font-medium' : 'text-zinc-800 font-medium'
                    }`}>
                      {senderName}
                    </span>

                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className={`flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                        isKanban
                          ? isDark ? 'bg-violet-500/10 text-violet-400' : 'bg-violet-50 text-violet-600'
                          : isDark ? 'bg-sky-500/10 text-sky-400' : 'bg-sky-50 text-sky-600'
                      }`}>
                        {isKanban ? <LayoutGrid size={9} /> : <CheckSquare size={9} />}
                        {isKanban ? 'Board' : 'List'}
                      </span>

                      <span className={`truncate text-[13px] ${
                        isCompleted
                          ? isDark ? 'text-zinc-600 line-through' : 'text-zinc-400 line-through'
                          : isDark ? 'text-zinc-200' : 'text-zinc-800'
                      }`}>
                        {task.content}
                      </span>

                      {(task.executionNote || task.bordTitle) && (
                        <span className={`hidden lg:inline truncate text-[13px] ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                          — {task.executionNote || task.bordTitle}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isKanban && hasColumns && (
                        <div className="relative">
                          <button
                            onClick={(e) => { e.stopPropagation(); setColumnDropdownId(columnDropdownId === task._id ? null : task._id) }}
                            disabled={isMoving}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                              isMoving
                                ? isDark ? 'bg-zinc-800 text-zinc-600' : 'bg-zinc-100 text-zinc-400'
                                : isDark ? 'bg-zinc-700/60 text-zinc-400 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                            }`}
                          >
                            {isMoving && <Loader2 size={8} className="animate-spin" />}
                            {task.columnTitle || 'No col'}
                            <ChevronDown size={8} />
                          </button>
                          {columnDropdownId === task._id && (
                            <div
                              className={`absolute top-full right-0 mt-1 rounded-lg border shadow-xl z-30 min-w-[150px] overflow-hidden ${
                                isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                              }`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {task.availableColumns.map((col) => (
                                <button
                                  key={col.id}
                                  onClick={() => handleMoveColumn(task._id, col.id, col.title)}
                                  disabled={col.id === task.columnId}
                                  className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                                    col.id === task.columnId
                                      ? isDark ? 'bg-zinc-700/50 text-zinc-300 font-medium' : 'bg-zinc-50 text-zinc-600 font-medium'
                                      : isDark ? 'text-zinc-300 hover:bg-zinc-700' : 'text-zinc-700 hover:bg-zinc-50'
                                  }`}
                                >
                                  {col.title}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {isKanban && !hasColumns && task.columnTitle && (
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${
                          isDark ? 'bg-zinc-700/60 text-zinc-500' : 'bg-zinc-100 text-zinc-500'
                        }`}>{task.columnTitle}</span>
                      )}

                      {task.priority === 'high' && (
                        <Flag size={12} className={isDark ? 'text-red-400' : 'text-red-500'} />
                      )}

                      {!isCompleted && (
                        <button
                          onClick={() => handleComplete(task._id)}
                          disabled={isCompleting}
                          className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-all ${
                            isCompleting ? 'opacity-100' : isDark ? 'text-zinc-600 hover:text-emerald-400 hover:bg-zinc-700' : 'text-zinc-400 hover:text-emerald-500 hover:bg-zinc-100'
                          }`}
                          title="Mark complete"
                        >
                          {isCompleting ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                        </button>
                      )}

                      {dueDateInfo ? (
                        <span className={`text-[11px] font-medium whitespace-nowrap min-w-[52px] text-right ${
                          dueDateInfo.overdue ? 'text-red-500' : isDark ? 'text-zinc-500' : 'text-zinc-400'
                        }`}>{dueDateInfo.text}</span>
                      ) : (
                        <span className={`text-[11px] whitespace-nowrap min-w-[52px] text-right ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                          {formatTimestamp(task.createdAt)}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}
