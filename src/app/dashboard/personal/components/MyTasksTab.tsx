'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  ArrowUpDown,
  Loader2,
  ListTodo,
  CheckSquare,
  LayoutGrid,
  Bell,
  Flame,
  Star,
  Flag,
  ChevronDown,
  ChevronRight,
  List,
  Columns3,
  CalendarClock,
  Building2,
  User,
  Plus,
  X,
  Pencil,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { emitAssignmentSync, onAssignmentSync } from '@/lib/boardEvents'
import CustomDropdown from '@/components/CustomDropdown'
import TaskEditModal from '@/components/delegation/TaskEditModal'

interface ChecklistItem {
  id: string
  text: string
  completed: boolean
}

interface TaskItem {
  itemId: string
  parentId: string
  parentType: 'checklist' | 'kanban' | 'reminder'
  parentTitle: string
  text: string
  completed: boolean
  status?: string | null
  dueDate: string | null
  priority?: string
  executionNote?: string | null
  descriptionType?: 'text' | 'checklist'
  checklistItems?: ChecklistItem[]
  assignedBy?: string | null
  skipReview?: boolean
  columnId?: string
  columnTitle?: string
  availableColumns?: { id: string; title: string }[] | null
  assignedTo?: string
  assignedToName?: string | null
  boardId: string
  boardTitle: string
  source: 'board' | 'assignment'
}

interface KanbanExecutionColumn {
  id: string
  title: string
  tasks: TaskItem[]
}

interface OrgMemberOption {
  userId: string
  name: string
  email?: string
}

interface TaskSummary {
  total: number
  incomplete: number
  completed: number
  overdue: number
  dueSoon: number
}

type FilterOption = 'all' | 'incomplete' | 'overdue' | 'due-soon' | 'completed'
type SortOption = 'due-date' | 'board' | 'type' | 'recent'
type ViewMode = 'list' | 'board'

// Time bucket keys in display order
type TimeBucket = 'overdue' | 'today' | 'tomorrow' | 'this-week' | 'later' | 'no-date' | 'done'

const BUCKET_LABELS: Record<TimeBucket, string> = {
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  'this-week': 'This Week',
  later: 'Later',
  'no-date': 'No Date',
  done: 'Completed',
}

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

const PRIORITY_CONFIG: Record<string, { color: string; darkColor: string }> = {
  high: { color: 'text-red-500 bg-red-50', darkColor: 'text-red-400 bg-red-500/10' },
  normal: { color: 'text-blue-500 bg-blue-50', darkColor: 'text-blue-400 bg-blue-500/10' },
  low: { color: 'text-zinc-500 bg-zinc-100', darkColor: 'text-zinc-400 bg-zinc-700/50' },
}

const EXECUTION_KANBAN_COLUMNS = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
] as const

function mapToExecutionColumn(task: TaskItem): (typeof EXECUTION_KANBAN_COLUMNS)[number]['id'] {
  if (task.completed) return 'done'

  // For assignment tasks, use the DB status field directly when available
  if (task.status) {
    if (task.status === 'completed') return 'done'
    if (task.status === 'in_progress') return 'in_progress'
    if (task.status === 'review') return 'review'
    if (task.status === 'backlog' || task.status === 'assigned' || task.status === 'pending') return 'backlog'
  }

  const rawId = (task.columnId || '').toLowerCase().trim()
  const rawTitle = (task.columnTitle || '').toLowerCase().trim()
  const raw = `${rawId} ${rawTitle}`

  if (raw.includes('done') || raw.includes('complete') || raw.includes('finished') || raw.includes('closed')) return 'done'
  if (raw.includes('review') || raw.includes('qa') || raw.includes('verify') || raw.includes('approval')) return 'review'
  if (raw.includes('progress') || raw.includes('doing') || raw.includes('active') || raw.includes('work')) return 'in_progress'
  if (raw.includes('todo') || raw.includes('to do') || raw.includes('queue') || raw.includes('new') || raw.includes('backlog')) return 'backlog'

  return 'backlog'
}

function resolveSourceColumnForExecution(
  task: TaskItem,
  executionColumnId: (typeof EXECUTION_KANBAN_COLUMNS)[number]['id']
): { id: string; title: string } | null {
  const cols = task.availableColumns || []
  if (!cols.length) return null

  const byMatch = (...needles: string[]) =>
    cols.find((c) => {
      const title = (c.title || '').toLowerCase()
      return needles.some((n) => title.includes(n))
    })

  if (executionColumnId === 'done') {
    return byMatch('done', 'complete', 'completed', 'finished', 'closed') || cols[cols.length - 1]
  }
  if (executionColumnId === 'review') {
    return byMatch('review', 'qa', 'verify', 'approval') || cols[Math.min(2, cols.length - 1)]
  }
  if (executionColumnId === 'in_progress') {
    return byMatch('progress', 'doing', 'active', 'work') || cols[Math.min(1, cols.length - 1)]
  }

  // backlog
  return byMatch('todo', 'to do', 'backlog', 'new', 'queue') || cols[0]
}

function getTimeBucket(task: TaskItem): TimeBucket {
  if (task.completed) return 'done'
  if (!task.dueDate) return 'no-date'

  const now = new Date()
  const due = new Date(task.dueDate)
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrowStart = new Date(todayStart.getTime() + 86400_000)
  const weekEnd = new Date(todayStart.getTime() + 7 * 86400_000)

  if (due < todayStart) return 'overdue'
  if (due < tomorrowStart) return 'today'
  if (due < new Date(tomorrowStart.getTime() + 86400_000)) return 'tomorrow'
  if (due < weekEnd) return 'this-week'
  return 'later'
}

function formatDueLabel(dateStr: string): { text: string; overdue: boolean } {
  const due = new Date(dateStr)
  const now = new Date()
  const diffMs = due.getTime() - now.getTime()
  const diffDays = Math.floor(diffMs / 86400_000)

  if (diffMs < 0) {
    const abs = Math.abs(Math.ceil(diffMs / 86400_000))
    return { text: abs <= 1 ? 'Overdue today' : `${abs}d overdue`, overdue: true }
  }
  if (diffDays === 0) {
    const h = Math.floor(diffMs / 3600_000)
    return { text: h < 1 ? `${Math.floor(diffMs / 60_000)}m left` : `${h}h left`, overdue: false }
  }
  if (diffDays === 1) return { text: 'Tomorrow', overdue: false }
  if (diffDays < 7) return { text: `${diffDays}d`, overdue: false }
  return { text: due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), overdue: false }
}

const BUCKET_ORDER: TimeBucket[] = ['overdue', 'today', 'tomorrow', 'this-week', 'later', 'no-date', 'done']

export default function MyTasksTab({
  isDark,
  onOpenBoard,
  orgId,
  canViewOrgScope,
  orgMembers,
  currentUserId,
}: {
  isDark: boolean
  onOpenBoard: (boardId: string) => void
  orgId?: string
  canViewOrgScope?: boolean
  orgMembers?: OrgMemberOption[]
  currentUserId?: string
}) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [summary, setSummary] = useState<TaskSummary>({ total: 0, incomplete: 0, completed: 0, overdue: 0, dueSoon: 0 })
  const [isLoading, setIsLoading] = useState(true)
  const [filter, setFilter] = useState<FilterOption>('all')
  const [sort, setSort] = useState<SortOption>('due-date')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [taskScope, setTaskScope] = useState<'mine' | 'org'>('mine')
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [columnDropdownId, setColumnDropdownId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [collapsedBuckets, setCollapsedBuckets] = useState<Set<TimeBucket>>(new Set(['done']))
  const [showQuickAssign, setShowQuickAssign] = useState(false)
  const [draggedTaskKey, setDraggedTaskKey] = useState<string | null>(null)
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null)
  const [quickTaskContent, setQuickTaskContent] = useState('')
  const [quickTaskType, setQuickTaskType] = useState<'checklist' | 'kanban'>('checklist')
  const [quickPriority, setQuickPriority] = useState<'low' | 'normal' | 'high'>('normal')
  const [quickDueDate, setQuickDueDate] = useState('')
  const [quickAssignedTo, setQuickAssignedTo] = useState('')
  const [quickExecutionNote, setQuickExecutionNote] = useState('')
  const [quickDescriptionType, setQuickDescriptionType] = useState<'text' | 'checklist'>('text')
  const [quickChecklistItems, setQuickChecklistItems] = useState<ChecklistItem[]>([])
  const [quickNewChecklistItem, setQuickNewChecklistItem] = useState('')
  const [quickSkipReview, setQuickSkipReview] = useState(false)
  const [scopeCounts, setScopeCounts] = useState<{ mine: number | null; org: number | null }>({ mine: null, org: null })
  const sortMenuRef = useRef<HTMLDivElement>(null)

  // Persist starred IDs in localStorage so they survive refresh
  const [starredIds, setStarredIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = localStorage.getItem('bords-starred-tasks')
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch { return new Set() }
  })

  const persistStars = (next: Set<string>) => {
    try { localStorage.setItem('bords-starred-tasks', JSON.stringify([...next])) } catch {}
    setStarredIds(next)
  }

  const c = {
    card: isDark ? 'bg-zinc-800/50' : 'bg-white',
    border: isDark ? 'border-zinc-700/50' : 'border-zinc-200',
    muted: isDark ? 'text-zinc-400' : 'text-zinc-500',
    hover: isDark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-50',
    headerBg: isDark ? 'bg-zinc-800/80' : 'bg-zinc-50/80',
    text: isDark ? 'text-white' : 'text-zinc-900',
  }

  // API filter: always fetch 'all' and bucket client-side so counts are accurate
  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ filter: 'all', sort })
      if (orgId) params.set('orgId', orgId)
      if (orgId && canViewOrgScope) params.set('scope', taskScope)
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
  }, [sort, orgId, canViewOrgScope, taskScope])

  const handleQuickAssign = async () => {
    if (!orgId || !quickAssignedTo || !quickTaskContent.trim()) {
      setAssignError('Assignee and task content are required')
      return
    }

    setAssigning(true)
    setAssignError('')
    try {
      const res = await fetch('/api/dashboard/my-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          assignedTo: quickAssignedTo,
          content: quickTaskContent,
          taskType: quickTaskType,
          priority: quickPriority,
          dueDate: quickDueDate || null,
          descriptionType: quickDescriptionType,
          executionNote: quickDescriptionType === 'text' ? (quickExecutionNote || null) : null,
          checklistItems: quickDescriptionType === 'checklist'
            ? quickChecklistItems.filter((i) => i.text.trim()).map((i) => ({ ...i, completed: false }))
            : [],
          skipReview: quickTaskType === 'kanban' ? quickSkipReview : undefined,
        }),
      })

      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAssignError(body.error || 'Failed to assign task')
        return
      }

      setQuickTaskContent('')
      setQuickTaskType('checklist')
      setQuickPriority('normal')
      setQuickDueDate('')
      setQuickAssignedTo('')
      setQuickExecutionNote('')
      setQuickDescriptionType('text')
      setQuickChecklistItems([])
      setQuickNewChecklistItem('')
      setQuickSkipReview(false)
      setShowQuickAssign(false)
      fetchTasks()
      emitAssignmentSync('', 'my-tasks-quick-assign')
    } catch {
      setAssignError('Failed to assign task')
    } finally {
      setAssigning(false)
    }
  }

  useEffect(() => {
    setIsLoading(true)
    fetchTasks()
  }, [fetchTasks])

  useEffect(() => {
    const interval = setInterval(() => fetchTasks(), 30_000)
    return () => clearInterval(interval)
  }, [fetchTasks])

  useEffect(() => {
    const off = onAssignmentSync(() => fetchTasks())
    return off
  }, [fetchTasks])

  // Cache total task counts per scope so both badges stay visible when switching
  useEffect(() => {
    setScopeCounts(prev => ({ ...prev, [taskScope]: summary.total }))
  }, [summary.total, taskScope])

  // Close sort menu + column dropdowns on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false)
      }
      setColumnDropdownId(null)
    }
    if (showSortMenu || columnDropdownId) {
      document.addEventListener('mousedown', handleClick)
      return () => document.removeEventListener('mousedown', handleClick)
    }
  }, [showSortMenu, columnDropdownId])

  // ── Handlers (unchanged logic) ─────────────────────────────────────────────

  const handleToggle = async (task: TaskItem) => {
    // Block if checklist description has incomplete items — open view modal instead
    if (
      task.source === 'assignment' &&
      !task.completed &&
      task.descriptionType === 'checklist' &&
      task.checklistItems && task.checklistItems.length > 0 &&
      task.checklistItems.some((i) => !i.completed)
    ) {
      setEditingTask(task)
      return
    }

    const key = `${task.boardId}-${task.itemId}`
    setTogglingId(key)
    try {
      let completed: boolean
      if (task.source === 'assignment') {
        const res = await fetch(`/api/execution/tasks/${task.itemId}/complete`, { method: 'POST' })
        if (!res.ok) return
        const data = await res.json()
        completed = data.task.status === 'completed'
      } else {
        const res = await fetch('/api/dashboard/my-tasks/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'toggle', source: task.source, itemId: task.itemId,
            boardId: task.boardId, parentType: task.parentType, text: task.text,
            completed: task.completed, dueDate: task.dueDate, priority: task.priority,
            columnId: task.columnId, columnTitle: task.columnTitle, availableColumns: task.availableColumns,
          }),
        })
        if (!res.ok) return
        const data = await res.json()
        completed = data.completed
      }
      setTasks((prev) => prev.map((t) =>
        t.boardId === task.boardId && t.itemId === task.itemId
          ? { ...t, completed, source: 'assignment' } : t
      ))
      setSummary((prev) => {
        const delta = completed ? 1 : -1
        return { ...prev, completed: prev.completed + delta, incomplete: prev.incomplete - delta }
      })
      if (task.boardId) emitAssignmentSync(task.boardId, 'my-tasks-toggle')
    } catch { /* silent */ } finally {
      setTogglingId(null)
    }
  }

  const handleMoveColumn = async (task: TaskItem, newColumnId: string, newColumnTitle: string) => {
    const key = `${task.boardId}-${task.itemId}`
    setMovingId(key)
    setColumnDropdownId(null)
    try {
      let resolvedColumnId = newColumnId
      let resolvedColumnTitle = newColumnTitle
      if (task.source === 'assignment') {
        const res = await fetch(`/api/execution/tasks/${task.itemId}/update`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ columnId: newColumnId, columnTitle: newColumnTitle }),
        })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        resolvedColumnId = data.task?.columnId || newColumnId
        resolvedColumnTitle = data.task?.columnTitle || newColumnTitle
      } else {
        const res = await fetch('/api/dashboard/my-tasks/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'move-column', source: task.source, itemId: task.itemId,
            boardId: task.boardId, parentType: task.parentType, text: task.text,
            completed: task.completed, columnId: newColumnId, columnTitle: newColumnTitle,
            availableColumns: task.availableColumns, dueDate: task.dueDate, priority: task.priority,
          }),
        })
        if (!res.ok) return
        const data = await res.json().catch(() => ({}))
        resolvedColumnId = data.columnId || newColumnId
        resolvedColumnTitle = data.columnTitle || newColumnTitle
      }
      setTasks((prev) => prev.map((t) =>
        t.boardId === task.boardId && t.itemId === task.itemId
          ? { ...t, columnId: resolvedColumnId, columnTitle: resolvedColumnTitle, source: 'assignment' } : t
      ))
      if (task.boardId) emitAssignmentSync(task.boardId, 'my-tasks-move')
    } catch { /* silent */ } finally {
      setMovingId(null)
    }
  }

  const handleKanbanDrop = async (task: TaskItem, targetColumnId: string, targetColumnTitle: string) => {
    const resolved = resolveSourceColumnForExecution(
      task,
      targetColumnId as (typeof EXECUTION_KANBAN_COLUMNS)[number]['id']
    )

    const nextColumnId = resolved?.id || targetColumnId
    const nextColumnTitle = resolved?.title || targetColumnTitle

    // Keep status and execution column aligned while respecting API rules:
    // completed assignments may reject column updates, so for "move to done"
    // we must move first, then complete.
    if (targetColumnId === 'done' && !task.completed) {
      // Block assignee from dragging to done when skip_review is off — assigner must confirm
      if (
        task.source === 'assignment' &&
        task.assignedBy !== currentUserId &&
        !task.skipReview
      ) return

      // Block if checklist items are incomplete — open view modal instead
      if (
        task.source === 'assignment' &&
        task.descriptionType === 'checklist' &&
        task.checklistItems && task.checklistItems.length > 0 &&
        task.checklistItems.some((i) => !i.completed)
      ) {
        setEditingTask(task)
        return
      }
      await handleMoveColumn(task, nextColumnId, nextColumnTitle)
      await handleToggle(task)
      return
    }

    // For "move out of done", reopen first, then move.
    if (targetColumnId !== 'done' && task.completed) {
      await handleToggle(task)
      await handleMoveColumn(task, nextColumnId, nextColumnTitle)
      return
    }

    await handleMoveColumn(task, nextColumnId, nextColumnTitle)
  }

  const handleBulkComplete = async () => {
    for (const id of Array.from(selectedIds)) {
      const task = tasks.find((t) => `${t.boardId}-${t.itemId}` === id)
      if (task && !task.completed) await handleToggle(task)
    }
    setSelectedIds(new Set())
  }

  const toggleSelect = (key: string) => setSelectedIds((prev) => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  const toggleStar = (key: string) => {
    const next = new Set(starredIds)
    if (next.has(key)) next.delete(key); else next.add(key)
    persistStars(next)
  }

  const toggleBucket = (bucket: TimeBucket) => setCollapsedBuckets((prev) => {
    const next = new Set(prev)
    if (next.has(bucket)) next.delete(bucket); else next.add(bucket)
    return next
  })

  // ── Derived data ───────────────────────────────────────────────────────────

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (filter === 'overdue') return !t.completed && !!t.dueDate && new Date(t.dueDate).getTime() < Date.now()
      if (filter === 'due-soon') {
        const soon = Date.now() + 48 * 3600_000
        return !t.completed && !!t.dueDate && new Date(t.dueDate).getTime() >= Date.now() && new Date(t.dueDate).getTime() <= soon
      }
      if (filter === 'completed') return t.completed
      if (filter === 'incomplete') return !t.completed
      return true // 'all'
    })
  }, [tasks, filter])

  const checklistTasks = useMemo(
    () => filteredTasks.filter((t) => t.parentType !== 'kanban'),
    [filteredTasks]
  )

  const kanbanTasks = useMemo(
    () => filteredTasks.filter((t) => t.parentType === 'kanban'),
    [filteredTasks]
  )

  // Bucket checklist tasks
  const buckets = useMemo(() => {
    const map: Record<TimeBucket, TaskItem[]> = {
      overdue: [], today: [], tomorrow: [], 'this-week': [], later: [], 'no-date': [], done: [],
    }
    for (const t of checklistTasks) {
      // Sort stars to top within bucket
      map[getTimeBucket(t)].push(t)
    }
    for (const key of BUCKET_ORDER) {
      map[key].sort((a, b) => {
        const aS = starredIds.has(`${a.boardId}-${a.itemId}`) ? 0 : 1
        const bS = starredIds.has(`${b.boardId}-${b.itemId}`) ? 0 : 1
        if (aS !== bS) return aS - bS
        const prio = { high: 0, normal: 1, low: 2 }
        const ap = prio[a.priority as keyof typeof prio] ?? 1
        const bp = prio[b.priority as keyof typeof prio] ?? 1
        return ap - bp
      })
    }
    return map
  }, [checklistTasks, starredIds])

  // Kanban view: group kanban tasks into canonical execution columns.
  const boardColumns: KanbanExecutionColumn[] = useMemo(() => {
    if (viewMode !== 'board') return []
    const colMap = new Map<string, { title: string; tasks: TaskItem[] }>()
    for (const col of EXECUTION_KANBAN_COLUMNS) {
      colMap.set(col.id, { title: col.title, tasks: [] })
    }

    for (const t of kanbanTasks) {
      const colKey = mapToExecutionColumn(t)
      colMap.get(colKey)?.tasks.push(t)
    }

    // Sort each column: stars first, then incomplete before done, then priority
    const prio = { high: 0, normal: 1, low: 2 }
    for (const col of colMap.values()) {
      col.tasks.sort((a, b) => {
        const aS = starredIds.has(`${a.boardId}-${a.itemId}`) ? 0 : 1
        const bS = starredIds.has(`${b.boardId}-${b.itemId}`) ? 0 : 1
        if (aS !== bS) return aS - bS
        if (a.completed !== b.completed) return a.completed ? 1 : -1
        const ap = prio[a.priority as keyof typeof prio] ?? 1
        const bp = prio[b.priority as keyof typeof prio] ?? 1
        return ap - bp
      })
    }
    return EXECUTION_KANBAN_COLUMNS.map((c) => ({
      id: c.id,
      title: c.title,
      tasks: colMap.get(c.id)?.tasks || [],
    }))
  }, [kanbanTasks, viewMode, starredIds])

  const activeBuckets = BUCKET_ORDER.filter((b) => buckets[b].length > 0)
  const visibleBuckets = filter === 'completed' ? activeBuckets : activeBuckets

  const viewScopedTasks = viewMode === 'board' ? kanbanTasks : checklistTasks

  const filterCounts = useMemo(() => ({
    all: viewScopedTasks.length,
    incomplete: viewScopedTasks.filter((t) => !t.completed).length,
    overdue: viewScopedTasks.filter((t) => !t.completed && !!t.dueDate && new Date(t.dueDate).getTime() < Date.now()).length,
    'due-soon': viewScopedTasks.filter((t) => {
      const soon = Date.now() + 48 * 3600_000
      return !t.completed && !!t.dueDate && new Date(t.dueDate).getTime() >= Date.now() && new Date(t.dueDate).getTime() <= soon
    }).length,
    completed: viewScopedTasks.filter((t) => t.completed).length,
  }), [viewScopedTasks])

  const viewSummary = useMemo(() => {
    const incomplete = viewScopedTasks.filter((t) => !t.completed)
    const now = Date.now()
    return {
      incomplete: incomplete.length,
      completed: viewScopedTasks.length - incomplete.length,
      overdue: incomplete.filter((t) => t.dueDate && new Date(t.dueDate).getTime() < now).length,
    }
  }, [viewScopedTasks])

  const incompleteSelected = useMemo(() =>
    Array.from(selectedIds).filter((k) => {
      const t = tasks.find((t) => `${t.boardId}-${t.itemId}` === k)
      return t && !t.completed
    }).length
  , [selectedIds, tasks])

  // Orange dot: tasks assigned by someone else that haven't been started yet
  const newTaskIndicators = useMemo(() => {
    const freshlyAssigned = tasks.filter(
      t => !t.completed && t.source === 'assignment' && t.assignedBy !== currentUserId && t.status === 'assigned'
    )
    return {
      checklist: freshlyAssigned.some(t => t.parentType !== 'kanban'),
      kanban: freshlyAssigned.some(t => t.parentType === 'kanban'),
    }
  }, [tasks, currentUserId])

  // ── Rendering helpers ──────────────────────────────────────────────────────

  const renderTaskRow = (task: TaskItem) => {
    const key = `${task.boardId}-${task.itemId}`
    const TypeIcon = TYPE_ICONS[task.parentType] || CheckSquare
    const isOverdue = !task.completed && task.dueDate && new Date(task.dueDate).getTime() < Date.now()
    const isToggling = togglingId === key
    const isMoving = movingId === key
    const isSelected = selectedIds.has(key)
    const isStarred = starredIds.has(key)
    const dueFmt = task.dueDate ? formatDueLabel(task.dueDate) : null
    const priCfg = task.priority ? (isDark ? PRIORITY_CONFIG[task.priority]?.darkColor : PRIORITY_CONFIG[task.priority]?.color) : null
    const canEdit = task.source === 'assignment' && (task.assignedBy === currentUserId || !!canViewOrgScope)

    return (
      <motion.div
        key={key}
        layout
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ duration: 0.15 }}
        className={`group flex items-start gap-3 px-4 py-3 border-b last:border-b-0 transition-colors ${
          isDark ? 'border-zinc-700/40' : 'border-zinc-100'
        } ${isSelected ? (isDark ? 'bg-blue-500/8' : 'bg-blue-50/50') : c.hover}`}
      >
        {/* Select */}
        <button
          onClick={() => toggleSelect(key)}
          className={`flex-shrink-0 mt-0.5 ${c.muted} hover:text-blue-500 transition-colors`}
        >
          {isSelected
            ? <CheckCircle2 size={14} className="text-blue-500" />
            : <Circle size={14} className="opacity-0 group-hover:opacity-100 transition-opacity" />}
        </button>

        {/* Complete toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); handleToggle(task) }}
          disabled={isToggling}
          className="flex-shrink-0 mt-[3px]"
        >
          {isToggling
            ? <Loader2 size={15} className="animate-spin text-blue-500" />
            : task.completed
              ? <CheckCircle2 size={15} className="text-emerald-500 hover:text-emerald-400 transition-colors" />
              : <Circle size={15} className={`transition-colors ${isOverdue ? 'text-red-400' : c.muted} hover:text-emerald-500`} />}
        </button>

        {/* Main content */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => task.boardId ? onOpenBoard(task.boardId) : setEditingTask(task)}
        >
          <p className={`text-sm leading-snug ${
            task.completed ? `line-through ${isDark ? 'text-zinc-500' : 'text-zinc-400'}` : c.text
          }`}>
            {task.text || 'Untitled'}
          </p>

          {task.descriptionType === 'checklist' && task.checklistItems && task.checklistItems.length > 0 ? (() => {
            const done = task.checklistItems!.filter((i) => i.completed).length
            const total = task.checklistItems!.length
            const pct = Math.round((done / total) * 100)
            return (
              <div className="flex items-center gap-2 mt-1">
                <div className={`w-16 h-1.5 rounded-full overflow-hidden flex-shrink-0 ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#10b981' : '#3b82f6' }}
                  />
                </div>
                <span className={`text-[10px] font-medium ${pct === 100 ? 'text-emerald-500' : isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  {done}/{total} · {pct}%
                </span>
              </div>
            )
          })() : task.executionNote ? (
            <p className={`text-xs mt-0.5 truncate ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
              {task.executionNote}
            </p>
          ) : null}

          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {/* Type */}
            <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${
              isDark ? 'bg-zinc-700/50 text-zinc-400' : 'bg-zinc-100 text-zinc-500'
            }`}>
              <TypeIcon size={9} />
              {task.parentType.charAt(0).toUpperCase() + task.parentType.slice(1)}
            </span>

            {/* Priority */}
            {task.priority && task.priority !== 'normal' && priCfg && (
              <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${priCfg}`}>
                <Flag size={9} />
                {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
              </span>
            )}

            {/* Board title */}
            <span className={`inline-flex items-center gap-0.5 text-[10px] ${c.muted} truncate max-w-[120px]`}>
              {task.source === 'assignment' ? <Building2 size={9} /> : <User size={9} />}
              {task.boardTitle}
            </span>

            {task.assignedToName && orgId && canViewOrgScope && taskScope === 'org' && (
              <span className={`inline-flex items-center gap-0.5 text-[10px] ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`}>
                <User size={9} />
                <span className="truncate max-w-[100px]">{task.assignedToName}</span>
              </span>
            )}

            {/* Due date — below on mobile */}
            {dueFmt && (
              <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${
                dueFmt.overdue ? 'text-red-500' : isDark ? 'text-zinc-500' : 'text-zinc-400'
              }`}>
                <CalendarClock size={9} />
                {dueFmt.text}
              </span>
            )}
          </div>
        </div>

        {/* Star */}
        <button
          onClick={(e) => { e.stopPropagation(); toggleStar(key) }}
          className={`flex-shrink-0 mt-0.5 transition-colors ${
            isStarred ? 'text-amber-400' : `${c.muted} opacity-0 group-hover:opacity-60 hover:!opacity-100`
          }`}
        >
          <Star size={13} fill={isStarred ? 'currentColor' : 'none'} />
        </button>

        {/* Kanban column picker */}
        {task.parentType === 'kanban' && task.availableColumns && task.availableColumns.length > 1 && (
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setColumnDropdownId(columnDropdownId === key ? null : key) }}
              disabled={isMoving}
              className={`inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded font-medium transition-colors ${
                isDark ? 'bg-zinc-700/50 text-zinc-300 hover:bg-zinc-600/60' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {isMoving ? <Loader2 size={9} className="animate-spin" /> : <LayoutGrid size={9} />}
              <span className="max-w-[64px] truncate">{task.columnTitle || '—'}</span>
              <ChevronDown size={9} />
            </button>
            {columnDropdownId === key && (
              <div
                className={`absolute top-full right-0 mt-1 py-1 rounded-xl border shadow-xl z-50 min-w-[140px] ${
                  isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
                }`}
                onClick={(e) => e.stopPropagation()}
              >
                {task.availableColumns.map((col) => (
                  <button
                    key={col.id}
                    onClick={() => handleMoveColumn(task, col.id, col.title)}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center justify-between gap-2 ${
                      col.id === task.columnId
                        ? isDark ? 'text-blue-400 font-medium' : 'text-blue-600 font-medium'
                        : isDark ? 'text-zinc-300 hover:bg-zinc-700/50' : 'text-zinc-700 hover:bg-zinc-50'
                    }`}
                  >
                    {col.title}
                    {col.id === task.columnId && <CheckCircle2 size={10} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Edit button — only for assigner / org manager */}
        {canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); setEditingTask(task) }}
            title="Edit task"
            className={`flex-shrink-0 p-1 rounded transition-all ${
              isDark ? 'text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-200' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
            }`}
          >
            <Pencil size={12} />
          </button>
        )}

        {/* Done button */}
        {!task.completed && !isToggling && (
          <button
            onClick={(e) => { e.stopPropagation(); handleToggle(task) }}
            className={`flex-shrink-0 text-[10px] font-semibold px-2 py-1 rounded transition-all opacity-0 group-hover:opacity-100 ${
              isDark ? 'text-emerald-400 hover:bg-emerald-500/15' : 'text-emerald-600 hover:bg-emerald-50'
            }`}
          >
            Done
          </button>
        )}
      </motion.div>
    )
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={26} className="animate-spin text-blue-500" />
      </div>
    )
  }

  const FILTER_PILLS: { id: FilterOption; label: string; icon?: typeof AlertTriangle }[] = [
    { id: 'all', label: 'All' },
    { id: 'incomplete', label: 'Incomplete' },
    { id: 'overdue', label: 'Overdue', icon: AlertTriangle },
    { id: 'due-soon', label: 'Due Soon', icon: Flame },
    { id: 'completed', label: 'Done' },
  ]

  const assigneeOptions = (orgMembers || []).map((m) => ({
    value: m.userId,
    label: m.name,
    description: m.email,
  }))

  const typeOptions = [
    { value: 'checklist', label: 'Checklist' },
    { value: 'kanban', label: 'Kanban' },
  ]

  const priorityOptions = [
    { value: 'low', label: 'Low' },
    { value: 'normal', label: 'Normal' },
    { value: 'high', label: 'High' },
  ]

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className={`text-2xl font-bold ${c.text}`}>My Tasks</h1>
          <p className={`text-sm mt-0.5 ${c.muted}`}>
            {viewSummary.incomplete} incomplete · {viewSummary.overdue > 0 ? (
              <span className="text-red-500 font-medium">{viewSummary.overdue} overdue</span>
            ) : '0 overdue'} · {viewSummary.completed} done
          </p>

          {/* Structure view toggle */}
          <div className={`mt-3 flex items-center rounded-lg border p-0.5 flex-shrink-0 ${isDark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'}`}>
            <button
              onClick={() => setViewMode('list')}
              className={`relative flex-1 px-2 py-1.5 rounded text-xs transition-colors ${viewMode === 'list' ? (isDark ? 'bg-zinc-700 text-white' : 'bg-white text-zinc-900 shadow-sm') : c.muted}`}
              title="Checklist view"
            >
              <span className="flex items-center justify-center gap-1.5">
                <List size={13} />
                Checklist
              </span>
              {newTaskIndicators.checklist && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400 ring-1 ring-white dark:ring-zinc-800" />
              )}
            </button>
            <button
              onClick={() => setViewMode('board')}
              className={`relative flex-1 px-2 py-1.5 rounded text-xs transition-colors ${viewMode === 'board' ? (isDark ? 'bg-zinc-700 text-white' : 'bg-white text-zinc-900 shadow-sm') : c.muted}`}
              title="Kanban view"
            >
              <span className="flex items-center justify-center gap-1.5">
                <Columns3 size={13} />
                Kanban
              </span>
              {newTaskIndicators.kanban && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400 ring-1 ring-white dark:ring-zinc-800" />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {orgId && canViewOrgScope && (
            <button
              type="button"
              onClick={() => setShowQuickAssign(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${isDark ? 'bg-blue-500 text-white hover:bg-blue-400' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
            >
              <Plus size={12} />
              Assign Task
            </button>
          )}

          {orgId && canViewOrgScope && (
            <div className="inline-flex items-center gap-1 rounded-lg border p-1 border-zinc-200 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setTaskScope('mine')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors ${
                  taskScope === 'mine'
                    ? isDark ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-white'
                    : isDark ? 'text-zinc-400 hover:bg-zinc-700/50' : 'text-zinc-500 hover:bg-zinc-100'
                }`}
              >
                My Tasks
                {scopeCounts.mine !== null && (
                  <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold ${
                    taskScope === 'mine'
                      ? 'bg-white/20 text-white'
                      : isDark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'
                  }`}>
                    {scopeCounts.mine}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setTaskScope('org')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md transition-colors ${
                  taskScope === 'org'
                    ? isDark ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-white'
                    : isDark ? 'text-zinc-400 hover:bg-zinc-700/50' : 'text-zinc-500 hover:bg-zinc-100'
                }`}
              >
                Organization
                {scopeCounts.org !== null && (
                  <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold ${
                    taskScope === 'org'
                      ? 'bg-white/20 text-white'
                      : isDark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'
                  }`}>
                    {scopeCounts.org}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Filter pills + Sort ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <div className="flex items-center gap-1 flex-wrap">
          {FILTER_PILLS.map(({ id, label, icon: Icon }) => {
            const count = filterCounts[id]
            const active = filter === id
            return (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  active
                    ? id === 'overdue' && count > 0
                      ? 'bg-red-500 text-white'
                      : id === 'due-soon' && count > 0
                        ? 'bg-amber-500 text-white'
                        : isDark ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/30' : 'bg-blue-50 text-blue-600 ring-1 ring-blue-200'
                    : isDark ? 'text-zinc-400 hover:text-zinc-300 hover:bg-zinc-700/50' : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                {Icon && <Icon size={10} />}
                {label}
                {count > 0 && (
                  <span className={`ml-0.5 ${
                    active ? 'opacity-80' : isDark ? 'text-zinc-500' : 'text-zinc-400'
                  }`}>{count}</span>
                )}
              </button>
            )
          })}
        </div>

        <div className="flex-1" />

        {/* Bulk complete */}
        {incompleteSelected > 0 && (
          <button
            onClick={handleBulkComplete}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors"
          >
            <CheckCircle2 size={11} />
            Complete {incompleteSelected}
          </button>
        )}

        {/* Sort */}
        <div className="relative" ref={sortMenuRef}>
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              isDark ? 'border-zinc-700 text-zinc-400 hover:bg-zinc-700/50' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'
            }`}
          >
            <ArrowUpDown size={12} />
            {SORT_OPTIONS.find(s => s.id === sort)?.label}
          </button>
          {showSortMenu && (
            <div className={`absolute top-full right-0 mt-1 py-1 rounded-xl border shadow-lg z-30 min-w-[130px] ${
              isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
            }`}>
              {SORT_OPTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { setSort(s.id); setShowSortMenu(false) }}
                  className={`w-full text-left px-3 py-1.5 text-xs flex items-center justify-between gap-2 transition-colors ${
                    sort === s.id
                      ? isDark ? 'text-blue-400 font-medium' : 'text-blue-600 font-medium'
                      : isDark ? 'text-zinc-300 hover:bg-zinc-700/50' : 'text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  {s.label}
                  {sort === s.id && <CheckCircle2 size={10} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────── */}
      {viewScopedTasks.length === 0 && (
        <div className={`${c.card} border ${c.border} rounded-2xl py-16 text-center`}>
          <ListTodo size={34} className={`mx-auto mb-3 ${isDark ? 'text-zinc-600' : 'text-zinc-300'}`} />
          <p className={`text-sm font-medium ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            {filter === 'all'
              ? viewMode === 'board' ? 'No kanban tasks yet' : 'No checklist tasks yet'
              : `No ${filter.replace('-', ' ')} tasks`}
          </p>
          <p className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            {viewMode === 'board'
              ? 'Kanban-type assignments appear in this view.'
              : 'Checklist and reminder tasks appear in this view.'}
          </p>
        </div>
      )}

      {/* ── KANBAN VIEW ──────────────────────────────────────────────────── */}
      {viewMode === 'board' && viewScopedTasks.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {boardColumns.map((col) => (
            <div
              key={col.id}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragOverColumnId !== col.id) setDragOverColumnId(col.id)
              }}
              onDragLeave={() => {
                if (dragOverColumnId === col.id) setDragOverColumnId(null)
              }}
              onDrop={async (e) => {
                e.preventDefault()
                const key = draggedTaskKey || e.dataTransfer.getData('text/plain')
                if (!key) return
                const dragged = kanbanTasks.find((t) => `${t.boardId}-${t.itemId}` === key)
                if (!dragged) return
                await handleKanbanDrop(dragged, col.id, col.title)
                setDraggedTaskKey(null)
                setDragOverColumnId(null)
              }}
              className={`flex-shrink-0 w-[280px] rounded-xl border ${c.border} overflow-hidden transition-colors ${dragOverColumnId === col.id ? (isDark ? 'ring-1 ring-blue-500/50 bg-blue-500/5' : 'ring-1 ring-blue-300 bg-blue-50/30') : ''}`}
            >
              {/* Column header */}
              <div className={`px-3 py-2.5 flex items-center justify-between border-b ${c.border} ${c.headerBg}`}>
                <span className={`text-xs font-semibold ${c.text}`}>{col.title}</span>
                <span className={`text-[11px] ${c.muted}`}>{col.tasks.length}</span>
              </div>
              {/* Column tasks */}
              <div className={`${c.card} min-h-[220px] p-2 space-y-2`}>
                <AnimatePresence initial={false}>
                  {col.tasks.map((task) => {
                    const key = `${task.boardId}-${task.itemId}`
                    const isDragging = draggedTaskKey === key
                    const dueFmt = task.dueDate ? formatDueLabel(task.dueDate) : null

                    return (
                      <motion.div
                        key={key}
                        layout
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: isDragging ? 0.5 : 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        draggable
                        onDragStart={(e) => {
                          setDraggedTaskKey(key)
                          const dataTransfer = (e as { dataTransfer?: DataTransfer }).dataTransfer
                          if (dataTransfer) {
                            dataTransfer.effectAllowed = 'move'
                            dataTransfer.setData('text/plain', key)
                          }
                        }}
                        onDragEnd={() => {
                          setDraggedTaskKey(null)
                          setDragOverColumnId(null)
                        }}
                        className={`rounded-lg border p-3 cursor-grab active:cursor-grabbing ${isDark ? 'border-zinc-700/60 bg-zinc-900/40 hover:bg-zinc-800/60' : 'border-zinc-200 bg-white hover:bg-zinc-50'} transition-colors`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleToggle(task)
                            }}
                            disabled={togglingId === key}
                            className="mt-0.5 shrink-0"
                            title={task.completed ? 'Mark as not done' : 'Mark as done'}
                          >
                            {togglingId === key
                              ? <Loader2 size={14} className="animate-spin text-blue-500" />
                              : task.completed
                                ? <CheckCircle2 size={14} className="text-emerald-500" />
                                : <Circle size={14} className={isDark ? 'text-zinc-500 hover:text-emerald-400' : 'text-zinc-400 hover:text-emerald-500'} />}
                          </button>

                          <div
                            className="min-w-0 flex-1"
                            onClick={() => task.boardId ? onOpenBoard(task.boardId) : setEditingTask(task)}
                          >
                            <p className={`text-sm leading-snug ${task.completed ? (isDark ? 'line-through text-zinc-500' : 'line-through text-zinc-400') : c.text}`}>
                              {task.text || 'Untitled'}
                            </p>
                            {task.descriptionType === 'checklist' && task.checklistItems && task.checklistItems.length > 0 ? (() => {
                              const done = task.checklistItems!.filter((i) => i.completed).length
                              const total = task.checklistItems!.length
                              const pct = Math.round((done / total) * 100)
                              return (
                                <div className="flex items-center gap-2 mt-1">
                                  <div className={`w-16 h-1.5 rounded-full overflow-hidden flex-shrink-0 ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
                                    <div
                                      className="h-full rounded-full transition-all duration-300"
                                      style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#10b981' : '#3b82f6' }}
                                    />
                                  </div>
                                  <span className={`text-[10px] font-medium ${pct === 100 ? 'text-emerald-500' : isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                    {done}/{total} · {pct}%
                                  </span>
                                </div>
                              )
                            })() : task.executionNote ? (
                              <p className={`text-xs mt-0.5 truncate ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                {task.executionNote}
                              </p>
                            ) : null}

                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium ${isDark ? 'bg-zinc-700/50 text-zinc-400' : 'bg-zinc-100 text-zinc-500'}`}>
                                <LayoutGrid size={9} />
                                Kanban
                              </span>

                              {task.priority && task.priority !== 'normal' && (
                                <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-medium ${isDark ? PRIORITY_CONFIG[task.priority]?.darkColor : PRIORITY_CONFIG[task.priority]?.color}`}>
                                  <Flag size={9} />
                                  {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                                </span>
                              )}

                              <span className={`inline-flex items-center gap-0.5 text-[10px] ${c.muted} truncate max-w-[120px]`}>
                                <Building2 size={9} />
                                {task.boardTitle}
                              </span>

                              {task.columnTitle && (
                                <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded ${isDark ? 'bg-zinc-700/40 text-zinc-300' : 'bg-zinc-100 text-zinc-600'}`}>
                                  Source: {task.columnTitle}
                                </span>
                              )}

                              {task.assignedToName && orgId && canViewOrgScope && taskScope === 'org' && (
                                <span className={`inline-flex items-center gap-0.5 text-[10px] ${isDark ? 'text-zinc-300' : 'text-zinc-600'}`}>
                                  <User size={9} />
                                  <span className="truncate max-w-[100px]">{task.assignedToName}</span>
                                </span>
                              )}

                              {dueFmt && (
                                <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${dueFmt.overdue ? 'text-red-500' : isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                                  <CalendarClock size={9} />
                                  {dueFmt.text}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col items-center gap-1 shrink-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleStar(key)
                              }}
                              className={`transition-colors ${starredIds.has(key) ? 'text-amber-400' : c.muted}`}
                            >
                              <Star size={13} fill={starredIds.has(key) ? 'currentColor' : 'none'} />
                            </button>
                            {(task.assignedBy === currentUserId || !!canViewOrgScope) && task.source === 'assignment' && (
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingTask(task) }}
                                title="Edit task"
                                className={`p-0.5 rounded transition-colors ${
                                  isDark ? 'text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-200' : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700'
                                }`}
                              >
                                <Pencil size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── CHECKLIST VIEW ───────────────────────────────────────────────── */}
      {viewMode === 'list' && viewScopedTasks.length > 0 && (
        <div className="space-y-3">
          {visibleBuckets.map((bucket) => {
            const bucketTasks = buckets[bucket]
            if (bucketTasks.length === 0) return null
            const isCollapsed = collapsedBuckets.has(bucket)
            const bucketAllKeys = bucketTasks.map(t => `${t.boardId}-${t.itemId}`)
            const bucketAllSelected = bucketAllKeys.length > 0 && bucketAllKeys.every(k => selectedIds.has(k))

            return (
              <div key={bucket} className={`rounded-xl border overflow-hidden ${c.border}`}>
                {/* Bucket header */}
                <button
                  onClick={() => toggleBucket(bucket)}
                  className={`w-full flex items-center gap-2 px-4 py-2.5 transition-colors ${c.headerBg} ${c.hover}`}
                >
                  <span className={`transition-transform duration-200 ${c.muted} ${isCollapsed ? '' : 'rotate-90'}`}>
                    <ChevronRight size={13} />
                  </span>

                  {/* Bucket color dot */}
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    bucket === 'overdue' ? 'bg-red-500' :
                    bucket === 'today' ? 'bg-emerald-500' :
                    bucket === 'tomorrow' ? 'bg-blue-500' :
                    bucket === 'this-week' ? 'bg-violet-500' :
                    bucket === 'done' ? 'bg-zinc-400' :
                    isDark ? 'bg-zinc-600' : 'bg-zinc-300'
                  }`} />

                  <span className={`text-xs font-semibold ${
                    bucket === 'overdue' ? 'text-red-500' :
                    bucket === 'today' ? isDark ? 'text-emerald-400' : 'text-emerald-600' :
                    c.text
                  }`}>
                    {BUCKET_LABELS[bucket]}
                  </span>

                  <span className={`text-[11px] ${c.muted}`}>{bucketTasks.length}</span>

                  {/* Select-all for this bucket */}
                  {!isCollapsed && (
                    <span
                      className="ml-auto"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedIds((prev) => {
                          const next = new Set(prev)
                          if (bucketAllSelected) {
                            bucketAllKeys.forEach(k => next.delete(k))
                          } else {
                            bucketAllKeys.forEach(k => next.add(k))
                          }
                          return next
                        })
                      }}
                    >
                      <span className={`text-[10px] font-medium ${bucketAllSelected ? 'text-blue-500' : c.muted}`}>
                        {bucketAllSelected ? 'Deselect' : 'Select all'}
                      </span>
                    </span>
                  )}
                </button>

                {/* Tasks */}
                <AnimatePresence initial={false}>
                  {!isCollapsed && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className={`overflow-hidden ${c.card}`}
                    >
                      <AnimatePresence initial={false}>
                        {bucketTasks.map((task) => renderTaskRow(task))}
                      </AnimatePresence>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}
        </div>
      )}

      {/* Edit task modal */}
      {editingTask && (
        <TaskEditModal
          task={editingTask}
          isDark={isDark}
          canEdit={editingTask.assignedBy === currentUserId || !!canViewOrgScope}
          currentUserId={currentUserId}
          onClose={() => setEditingTask(null)}
          onSaved={(updates) => {
            setTasks((prev) => prev.map((t) =>
              t.itemId === editingTask.itemId
                ? {
                    ...t,
                    text: updates.text ?? t.text,
                    dueDate: updates.dueDate !== undefined ? updates.dueDate : t.dueDate,
                    priority: updates.priority ?? t.priority,
                    executionNote: updates.executionNote !== undefined ? updates.executionNote : t.executionNote,
                    descriptionType: updates.descriptionType ?? t.descriptionType,
                    checklistItems: updates.checklistItems !== undefined ? updates.checklistItems : t.checklistItems,
                  }
                : t
            ))
            setEditingTask(null)
          }}
          onDeleted={() => {
            setTasks((prev) => prev.filter((t) => t.itemId !== editingTask.itemId))
            setSummary((prev) => {
              const wasIncomplete = !editingTask.completed
              return {
                ...prev,
                total: prev.total - 1,
                incomplete: wasIncomplete ? prev.incomplete - 1 : prev.incomplete,
                completed: wasIncomplete ? prev.completed : prev.completed - 1,
              }
            })
            setEditingTask(null)
          }}
          onCompleted={() => {
            setTasks((prev) => prev.map((t) =>
              t.itemId === editingTask.itemId ? { ...t, completed: true } : t
            ))
            setSummary((prev) => ({
              ...prev,
              incomplete: Math.max(0, prev.incomplete - 1),
              completed: prev.completed + 1,
            }))
            setEditingTask(null)
          }}
          onChecklistUpdated={(items, status) => {
            setTasks((prev) => prev.map((t) =>
              t.itemId === editingTask.itemId
                ? { ...t, checklistItems: items, ...(status ? { status } : {}) }
                : t
            ))
          }}
        />
      )}

      {showQuickAssign && orgId && canViewOrgScope && (
        <div
          className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowQuickAssign(false)}
        >
          <div
            className={`w-full max-w-xl rounded-2xl border shadow-2xl ${isDark ? 'bg-zinc-900' : 'bg-white'} ${c.border}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between px-5 py-4 border-b ${c.border}`}>
              <h3 className={`text-sm font-semibold ${c.text}`}>Assign Task</h3>
              <button
                type="button"
                onClick={() => setShowQuickAssign(false)}
                className={`p-1 rounded ${isDark ? 'text-zinc-400 hover:bg-zinc-700/50' : 'text-zinc-500 hover:bg-zinc-100'}`}
                aria-label="Close assign task modal"
              >
                <X size={14} />
              </button>
            </div>

            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="md:col-span-2">
                <span className={`block text-xs mb-1 ${c.muted}`}>Task Content</span>
                <input
                  value={quickTaskContent}
                  onChange={(e) => setQuickTaskContent(e.target.value)}
                  placeholder="What needs to be done?"
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${isDark ? 'bg-zinc-900/60 border-zinc-700 text-white placeholder:text-zinc-500' : 'bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400'}`}
                />
              </label>

              <label>
                <span className={`block text-xs mb-1 ${c.muted}`}>Assign To</span>
                <CustomDropdown
                  options={assigneeOptions}
                  value={quickAssignedTo}
                  onChange={setQuickAssignedTo}
                  placeholder="Select member"
                  className="w-full"
                  showDescription
                />
              </label>

              <label>
                <span className={`block text-xs mb-1 ${c.muted}`}>Type</span>
                <CustomDropdown
                  options={typeOptions}
                  value={quickTaskType}
                  onChange={(value) => setQuickTaskType(value as 'checklist' | 'kanban')}
                  placeholder="Select type"
                  className="w-full"
                />
              </label>

              <label>
                <span className={`block text-xs mb-1 ${c.muted}`}>Priority</span>
                <CustomDropdown
                  options={priorityOptions}
                  value={quickPriority}
                  onChange={(value) => setQuickPriority(value as 'low' | 'normal' | 'high')}
                  placeholder="Select priority"
                  className="w-full"
                />
              </label>

              <label>
                <span className={`block text-xs mb-1 ${c.muted}`}>Due Date</span>
                <input
                  type="date"
                  value={quickDueDate}
                  onChange={(e) => setQuickDueDate(e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${isDark ? 'bg-zinc-900/60 border-zinc-700 text-white' : 'bg-white border-zinc-200 text-zinc-900'}`}
                />
              </label>

              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`text-xs ${c.muted}`}>Description <span className="font-normal opacity-60">(optional)</span></span>
                  <div className={`inline-flex rounded-lg border p-0.5 ${isDark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'}`}>
                    {(['text', 'checklist'] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setQuickDescriptionType(type)}
                        className={`px-2.5 py-0.5 rounded-md text-[11px] font-medium transition-colors capitalize ${
                          quickDescriptionType === type
                            ? isDark ? 'bg-zinc-700 text-white' : 'bg-white text-zinc-900 shadow-sm'
                            : c.muted
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                {quickDescriptionType === 'text' ? (
                  <textarea
                    value={quickExecutionNote}
                    onChange={(e) => setQuickExecutionNote(e.target.value)}
                    placeholder="Add context or instructions..."
                    rows={2}
                    className={`w-full rounded-lg border px-3 py-2 text-sm resize-none ${isDark ? 'bg-zinc-900/60 border-zinc-700 text-white placeholder:text-zinc-500' : 'bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400'}`}
                  />
                ) : (
                  <div className={`rounded-lg border overflow-hidden ${isDark ? 'border-zinc-700' : 'border-zinc-200'}`}>
                    {quickChecklistItems.map((item, idx) => (
                      <div key={item.id} className={`flex items-center gap-2 px-3 py-2 border-b ${isDark ? 'border-zinc-700' : 'border-zinc-200'} last:border-b-0`}>
                        <div className={`w-3 h-3 rounded border flex-shrink-0 ${isDark ? 'border-zinc-600' : 'border-zinc-300'}`} />
                        <input
                          value={item.text}
                          onChange={(e) => {
                            const next = [...quickChecklistItems]
                            next[idx] = { ...item, text: e.target.value }
                            setQuickChecklistItems(next)
                          }}
                          className={`flex-1 bg-transparent text-sm outline-none ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}
                        />
                        <button
                          type="button"
                          onClick={() => setQuickChecklistItems((prev) => prev.filter((_, i) => i !== idx))}
                          className={`flex-shrink-0 ${isDark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-300 hover:text-zinc-600'}`}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                    <div className={`flex items-center gap-2 px-3 py-2 ${isDark ? 'bg-zinc-800/30' : 'bg-zinc-50'}`}>
                      <Plus size={12} className={c.muted} />
                      <input
                        value={quickNewChecklistItem}
                        onChange={(e) => setQuickNewChecklistItem(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            const text = quickNewChecklistItem.trim()
                            if (text) {
                              setQuickChecklistItems((prev) => [...prev, { id: crypto.randomUUID(), text, completed: false }])
                              setQuickNewChecklistItem('')
                            }
                          }
                        }}
                        placeholder="Add an item…"
                        className={`flex-1 bg-transparent text-sm outline-none ${isDark ? 'text-zinc-200 placeholder:text-zinc-600' : 'text-zinc-800 placeholder:text-zinc-400'}`}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Skip review — only for kanban tasks */}
              {quickTaskType === 'kanban' && (
                <div className={`md:col-span-2 flex items-center justify-between p-3 rounded-xl border ${isDark ? 'bg-zinc-800/40 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                  <div className="flex-1 min-w-0 pr-3">
                    <p className={`text-xs font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>Skip review</p>
                    <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                      {quickSkipReview ? 'Assignee can complete tasks directly' : 'Completed tasks go to review for your approval'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuickSkipReview((v) => !v)}
                    className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors focus:outline-none ${quickSkipReview ? 'bg-emerald-500' : isDark ? 'bg-zinc-600' : 'bg-zinc-300'}`}
                    role="switch"
                    aria-checked={quickSkipReview}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${quickSkipReview ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
              )}

              {assignError && (
                <p className="md:col-span-2 mt-1 text-xs text-red-500">{assignError}</p>
              )}
            </div>

            <div className={`px-5 py-4 border-t ${c.border} flex justify-end gap-2`}>
              <button
                type="button"
                onClick={() => setShowQuickAssign(false)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${isDark ? 'text-zinc-300 hover:bg-zinc-700/50' : 'text-zinc-600 hover:bg-zinc-100'}`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleQuickAssign}
                disabled={assigning}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${isDark ? 'bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-60' : 'bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60'}`}
              >
                {assigning && <Loader2 size={12} className="animate-spin" />}
                Create Assignment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
