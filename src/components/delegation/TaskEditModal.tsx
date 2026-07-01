'use client'

import { useState, useEffect } from 'react'
import {
  X, Loader2, Flag, Calendar, MessageSquare, Trash2,
  AlertCircle, Pencil, Eye, History, ChevronDown, ChevronUp,
  CheckCircle2, Circle, Plus,
} from 'lucide-react'

export interface ChecklistItem {
  id: string
  text: string
  completed: boolean
}

interface TaskItem {
  itemId: string
  text: string
  dueDate: string | null
  priority?: string | null
  executionNote?: string | null
  assignedBy?: string | null
  source: 'board' | 'assignment'
  parentType: string
  boardTitle: string
  descriptionType?: 'text' | 'checklist'
  checklistItems?: ChecklistItem[]
}

interface ActivityEntry {
  id: string
  actorId: string
  actorName: string
  action: 'assigned' | 'edited' | 'completed' | 'reopened' | 'deleted'
  changes: Record<string, { before: any; after: any }>
  createdAt: string
}

interface TaskEditModalProps {
  task: TaskItem
  isDark: boolean
  canEdit: boolean
  onClose: () => void
  onSaved: (updates: {
    text?: string
    dueDate?: string | null
    priority?: string
    executionNote?: string | null
    descriptionType?: 'text' | 'checklist'
    checklistItems?: ChecklistItem[]
  }) => void
  onDeleted: () => void
  onCompleted?: () => void
  onChecklistUpdated?: (items: ChecklistItem[], status?: string) => void
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  assigned:  { label: 'Assigned',  color: 'text-blue-500' },
  edited:    { label: 'Edited',    color: 'text-amber-500' },
  completed: { label: 'Completed', color: 'text-emerald-500' },
  reopened:  { label: 'Reopened',  color: 'text-violet-500' },
  deleted:   { label: 'Deleted',   color: 'text-red-500' },
}

const CHANGE_LABELS: Record<string, string> = {
  content:       'Title',
  dueDate:       'Due Date',
  priority:      'Priority',
  executionNote: 'Description',
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60_000)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (d < 7) return `${d}d ago`
  return new Date(dateStr).toLocaleDateString()
}

const PRIORITY_BADGE: Record<string, { light: string; dark: string }> = {
  high:   { light: 'bg-red-50 text-red-600',   dark: 'bg-red-500/10 text-red-400' },
  normal: { light: 'bg-zinc-100 text-zinc-600', dark: 'bg-zinc-700 text-zinc-300' },
  low:    { light: 'bg-blue-50 text-blue-600',  dark: 'bg-blue-500/10 text-blue-400' },
}

export default function TaskEditModal({
  task, isDark, canEdit, onClose, onSaved, onDeleted, onCompleted, onChecklistUpdated,
}: TaskEditModalProps) {
  const [content, setContent] = useState(task.text)
  const [dueDate, setDueDate] = useState(
    task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''
  )
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>(
    (task.priority as 'low' | 'normal' | 'high') || 'normal'
  )
  const [descriptionType, setDescriptionType] = useState<'text' | 'checklist'>(
    task.descriptionType ?? 'text'
  )
  const [executionNote, setExecutionNote] = useState(task.executionNote ?? '')
  const [checklistItems, setChecklistItems] = useState<ChecklistItem[]>(task.checklistItems ?? [])
  const [newItemText, setNewItemText] = useState('')

  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const isAssignment = task.source === 'assignment'

  useEffect(() => {
    if (!isAssignment) { setActivityLoading(false); return }
    ;(async () => {
      try {
        const res = await fetch(`/api/execution/tasks/${task.itemId}/activity`)
        if (!res.ok) return
        const data = await res.json()
        setActivity(data.activity || [])
        if (data.executionNote !== undefined) setExecutionNote(data.executionNote ?? '')
        if (data.priority) setPriority(data.priority)
        if (data.dueDate) setDueDate(new Date(data.dueDate).toISOString().split('T')[0])
        if (data.descriptionType) setDescriptionType(data.descriptionType)
        if (data.checklistItems) setChecklistItems(data.checklistItems)
      } catch {
        // silent
      } finally {
        setActivityLoading(false)
      }
    })()
  }, [task.itemId, isAssignment])

  const addChecklistItem = () => {
    const text = newItemText.trim()
    if (!text) return
    setChecklistItems((prev) => [...prev, { id: crypto.randomUUID(), text, completed: false }])
    setNewItemText('')
  }

  const handleChecklistItemToggle = async (itemId: string, completed: boolean) => {
    setTogglingItemId(itemId)
    try {
      const res = await fetch(`/api/execution/tasks/${task.itemId}/checklist`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, completed }),
      })
      if (!res.ok) return
      const data = await res.json()
      setChecklistItems(data.checklistItems)
      onChecklistUpdated?.(data.checklistItems, data.status)
      if (data.taskCompleted) {
        onCompleted?.()
        onClose()
      }
    } catch {
      // silent
    } finally {
      setTogglingItemId(null)
    }
  }

  const handleSave = async () => {
    if (!content.trim()) { setError('Title cannot be empty'); return }
    setSaving(true)
    setError('')
    try {
      const validItems = checklistItems.filter((i) => i.text.trim())
      const body: Record<string, any> = {
        content: content.trim(),
        dueDate: dueDate || null,
        priority,
        descriptionType,
        executionNote: descriptionType === 'text' ? (executionNote.trim() || null) : null,
        checklistItems: descriptionType === 'checklist' ? validItems : [],
      }
      const res = await fetch(`/api/execution/tasks/${task.itemId}/update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json.error || 'Failed to save'); return }
      onSaved({
        text: json.task?.content ?? content.trim(),
        dueDate: dueDate || null,
        priority,
        executionNote: descriptionType === 'text' ? (executionNote.trim() || null) : null,
        descriptionType,
        checklistItems: descriptionType === 'checklist' ? validItems : [],
      })
      onClose()
    } catch {
      setError('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setError('')
    try {
      const res = await fetch(`/api/execution/tasks/${task.itemId}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error || 'Failed to delete')
        setDeleting(false)
        return
      }
      onDeleted()
      onClose()
    } catch {
      setError('Failed to delete')
      setDeleting(false)
    }
  }

  const c = {
    bg:       isDark ? 'bg-zinc-900' : 'bg-white',
    border:   isDark ? 'border-zinc-700/60' : 'border-zinc-200',
    text:     isDark ? 'text-white' : 'text-zinc-900',
    muted:    isDark ? 'text-zinc-400' : 'text-zinc-500',
    input:    isDark
      ? 'bg-zinc-800/60 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500'
      : 'bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-blue-400',
    section:  isDark ? 'bg-zinc-800/40' : 'bg-zinc-50',
    readOnly: isDark ? 'bg-zinc-800/30 text-zinc-200' : 'bg-zinc-50 text-zinc-800',
    itemRow:  isDark ? 'hover:bg-zinc-800/60' : 'hover:bg-zinc-50',
  }

  const PRIORITY_OPTIONS: { value: 'low' | 'normal' | 'high'; label: string; active: string; inactive: string }[] = [
    {
      value: 'low', label: 'Low',
      active:   isDark ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/40' : 'bg-blue-50 text-blue-600 ring-1 ring-blue-200',
      inactive: isDark ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
    },
    {
      value: 'normal', label: 'Normal',
      active:   isDark ? 'bg-zinc-600 text-white ring-1 ring-zinc-500' : 'bg-zinc-200 text-zinc-800 ring-1 ring-zinc-300',
      inactive: isDark ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
    },
    {
      value: 'high', label: 'High',
      active:   isDark ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/40' : 'bg-red-50 text-red-600 ring-1 ring-red-200',
      inactive: isDark ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
    },
  ]

  const prioBadge = PRIORITY_BADGE[priority] ?? PRIORITY_BADGE.normal
  const completedCount = checklistItems.filter((i) => i.completed).length
  const totalCount = checklistItems.length

  return (
    <div
      className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`w-full max-w-lg rounded-2xl border shadow-2xl flex flex-col max-h-[90vh] ${c.bg} ${c.border}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${c.border} flex-shrink-0`}>
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg ${isDark ? 'bg-zinc-800' : 'bg-zinc-100'}`}>
              {canEdit ? <Pencil size={14} className={c.muted} /> : <Eye size={14} className={c.muted} />}
            </div>
            <div>
              <h3 className={`text-sm font-semibold ${c.text}`}>
                {canEdit ? 'Edit Task' : 'Task Details'}
              </h3>
              <p className={`text-xs ${c.muted}`}>{task.boardTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-100'}`}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {canEdit ? (
            /* ── EDIT MODE ──────────────────────────────────────── */
            <>
              {/* Title */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${c.muted}`}>Title</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={2}
                  className={`w-full rounded-lg border px-3 py-2 text-sm resize-none outline-none transition-colors ${c.input}`}
                />
              </div>

              {/* Priority */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${c.muted}`}>
                  <Flag size={11} className="inline mr-1" />Priority
                </label>
                <div className="flex gap-2">
                  {PRIORITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setPriority(opt.value)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all ${priority === opt.value ? opt.active : opt.inactive}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Due date */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${c.muted}`}>
                  <Calendar size={11} className="inline mr-1" />Due Date
                  <span className="font-normal opacity-60 ml-1">(optional)</span>
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors ${c.input}`}
                />
              </div>

              {/* Description type toggle */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${c.muted}`}>
                  <MessageSquare size={11} className="inline mr-1" />Description
                  <span className="font-normal opacity-60 ml-1">(optional)</span>
                </label>
                <div className={`inline-flex rounded-lg border p-0.5 mb-3 ${isDark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-200 bg-zinc-50'}`}>
                  {(['text', 'checklist'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setDescriptionType(type)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors capitalize ${
                        descriptionType === type
                          ? isDark ? 'bg-zinc-700 text-white' : 'bg-white text-zinc-900 shadow-sm'
                          : c.muted
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                {descriptionType === 'text' ? (
                  <textarea
                    value={executionNote}
                    onChange={(e) => setExecutionNote(e.target.value)}
                    placeholder="Add context or instructions..."
                    rows={3}
                    className={`w-full rounded-lg border px-3 py-2 text-sm resize-none outline-none transition-colors ${c.input}`}
                  />
                ) : (
                  <div className={`rounded-lg border ${c.border} overflow-hidden`}>
                    {/* Existing items */}
                    {checklistItems.map((item, idx) => (
                      <div key={item.id} className={`flex items-center gap-2.5 px-3 py-2 border-b ${c.border} last:border-b-0`}>
                        {/* Read-only completion indicator — reflects assignee's progress */}
                        <div className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                          item.completed
                            ? 'bg-emerald-500 border-emerald-500'
                            : isDark ? 'border-zinc-600' : 'border-zinc-300'
                        }`}>
                          {item.completed && (
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                              <path d="M1.5 4L3 5.5L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </div>
                        <input
                          value={item.text}
                          onChange={(e) => {
                            const next = [...checklistItems]
                            next[idx] = { ...item, text: e.target.value }
                            setChecklistItems(next)
                          }}
                          placeholder="Item text…"
                          className={`flex-1 bg-transparent text-sm outline-none placeholder:${c.muted} ${
                            item.completed
                              ? 'line-through ' + (isDark ? 'text-zinc-500' : 'text-zinc-400')
                              : c.text
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() => setChecklistItems((prev) => prev.filter((_, i) => i !== idx))}
                          className={`flex-shrink-0 transition-colors ${isDark ? 'text-zinc-600 hover:text-zinc-300' : 'text-zinc-300 hover:text-zinc-600'}`}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}

                    {/* Add item row */}
                    <div className={`flex items-center gap-2.5 px-3 py-2 ${isDark ? 'bg-zinc-800/20' : 'bg-zinc-50/80'}`}>
                      <Plus size={13} className={c.muted} />
                      <input
                        value={newItemText}
                        onChange={(e) => setNewItemText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addChecklistItem() } }}
                        placeholder="Add an item…"
                        className={`flex-1 bg-transparent text-sm outline-none ${c.text} placeholder:text-zinc-500`}
                      />
                      {newItemText.trim() && (
                        <button
                          type="button"
                          onClick={addChecklistItem}
                          className={`text-xs px-2 py-0.5 rounded font-medium ${isDark ? 'text-blue-400 hover:bg-zinc-700' : 'text-blue-500 hover:bg-zinc-100'}`}
                        >
                          Add
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ── VIEW-ONLY MODE ─────────────────────────────────── */
            <>
              {/* Title */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${c.muted}`}>Title</label>
                <p className={`text-sm px-3 py-2 rounded-lg ${c.readOnly}`}>{content || 'Untitled'}</p>
              </div>

              {/* Priority */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${c.muted}`}>
                  <Flag size={11} className="inline mr-1" />Priority
                </label>
                <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${isDark ? prioBadge.dark : prioBadge.light}`}>
                  {priority.charAt(0).toUpperCase() + priority.slice(1)}
                </span>
              </div>

              {/* Due date */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${c.muted}`}>
                  <Calendar size={11} className="inline mr-1" />Due Date
                </label>
                <p className={`text-sm px-3 py-2 rounded-lg ${c.readOnly}`}>
                  {dueDate ? formatDate(dueDate) : <span className={c.muted}>No due date</span>}
                </p>
              </div>

              {/* Description — text or interactive checklist */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${c.muted}`}>
                  <MessageSquare size={11} className="inline mr-1" />Description
                </label>

                {activityLoading ? (
                  <div className="flex items-center gap-2 py-2">
                    <Loader2 size={13} className="animate-spin text-blue-500" />
                    <span className={`text-xs ${c.muted}`}>Loading…</span>
                  </div>
                ) : descriptionType === 'checklist' ? (
                  checklistItems.length === 0 ? (
                    <p className={`text-sm px-3 py-2 rounded-lg ${c.readOnly} ${c.muted}`}>No checklist items</p>
                  ) : (
                    <div className={`rounded-lg border ${c.border} overflow-hidden`}>
                      {/* Progress bar */}
                      <div className={`px-3 py-2 border-b ${c.border} flex items-center gap-2`}>
                        <div className={`flex-1 h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-zinc-700' : 'bg-zinc-200'}`}>
                          <div
                            className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                            style={{ width: `${totalCount ? (completedCount / totalCount) * 100 : 0}%` }}
                          />
                        </div>
                        <span className={`text-xs flex-shrink-0 font-medium ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                          {completedCount}/{totalCount}
                        </span>
                      </div>

                      {/* Items */}
                      {checklistItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleChecklistItemToggle(item.id, !item.completed)}
                          disabled={togglingItemId === item.id}
                          className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left border-b last:border-b-0 transition-colors ${c.border} ${c.itemRow}`}
                        >
                          {togglingItemId === item.id ? (
                            <Loader2 size={14} className="animate-spin text-blue-500 flex-shrink-0" />
                          ) : item.completed ? (
                            <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                          ) : (
                            <Circle size={14} className={`flex-shrink-0 ${c.muted}`} />
                          )}
                          <span className={`text-sm ${item.completed ? `line-through ${isDark ? 'text-zinc-500' : 'text-zinc-400'}` : c.text}`}>
                            {item.text}
                          </span>
                        </button>
                      ))}

                      {completedCount < totalCount && (
                        <p className={`px-3 py-2 text-xs ${isDark ? 'text-zinc-500 bg-zinc-800/30' : 'text-zinc-400 bg-zinc-50'}`}>
                          Complete all items to mark this task as done
                        </p>
                      )}
                    </div>
                  )
                ) : executionNote ? (
                  <p className={`text-sm px-3 py-2 rounded-lg whitespace-pre-wrap ${c.readOnly}`}>{executionNote}</p>
                ) : (
                  <p className={`text-sm px-3 py-2 rounded-lg ${c.readOnly} ${c.muted}`}>No description provided</p>
                )}
              </div>
            </>
          )}

          {/* Error */}
          {error && (
            <p className="flex items-center gap-1.5 text-xs text-red-500">
              <AlertCircle size={12} /> {error}
            </p>
          )}

          {/* Activity / History */}
          {isAssignment && (
            <div className={`rounded-xl border ${c.border} overflow-hidden`}>
              <button
                type="button"
                onClick={() => setShowHistory(!showHistory)}
                className={`w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium transition-colors ${c.section} ${isDark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-100'}`}
              >
                <span className={`flex items-center gap-1.5 ${c.muted}`}>
                  <History size={12} />
                  Task History
                  {!activityLoading && activity.length > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${isDark ? 'bg-zinc-700 text-zinc-300' : 'bg-zinc-200 text-zinc-600'}`}>
                      {activity.length}
                    </span>
                  )}
                </span>
                {showHistory ? <ChevronUp size={13} className={c.muted} /> : <ChevronDown size={13} className={c.muted} />}
              </button>

              {showHistory && (
                <div className={`border-t ${c.border}`}>
                  {activityLoading ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 size={16} className="animate-spin text-blue-500" />
                    </div>
                  ) : activity.length === 0 ? (
                    <p className={`text-xs text-center py-5 ${c.muted}`}>No history yet</p>
                  ) : (
                    <div className="divide-y divide-zinc-700/20">
                      {activity.map((entry) => {
                        const actionMeta = ACTION_LABELS[entry.action] || { label: entry.action, color: 'text-zinc-400' }
                        const changeKeys = Object.keys(entry.changes || {})
                        return (
                          <div key={entry.id} className={`px-4 py-3 ${c.bg}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className={`text-xs font-medium ${c.text}`}>
                                  <span className={actionMeta.color}>{actionMeta.label}</span>
                                  {' '}by <span className="font-semibold">{entry.actorName}</span>
                                </p>
                                {changeKeys.length > 0 && (
                                  <ul className={`mt-1 space-y-0.5 text-[11px] ${c.muted}`}>
                                    {changeKeys.map((key) => {
                                      const ch = entry.changes[key]
                                      const label = CHANGE_LABELS[key] || key
                                      const before = key === 'dueDate' ? formatDate(ch.before) : (ch.before ?? '—')
                                      const after  = key === 'dueDate' ? formatDate(ch.after)  : (ch.after  ?? '—')
                                      return (
                                        <li key={key}>
                                          <span className="font-medium">{label}:</span>{' '}
                                          <span className="line-through opacity-60">{String(before)}</span>
                                          {' → '}
                                          <span>{String(after)}</span>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )}
                              </div>
                              <span className={`text-[10px] flex-shrink-0 pt-0.5 ${c.muted}`}>
                                {formatRelative(entry.createdAt)}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between px-5 py-4 border-t ${c.border} flex-shrink-0 gap-3`}>
          {canEdit ? (
            <>
              <div className="flex items-center gap-2">
                {isAssignment && (
                  confirmDelete ? (
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${c.muted}`}>Sure?</span>
                      <button
                        type="button"
                        onClick={handleDelete}
                        disabled={deleting}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-60 transition-colors"
                      >
                        {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDark ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-500 hover:bg-zinc-100'}`}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDark ? 'text-red-400 hover:bg-red-500/15' : 'text-red-500 hover:bg-red-50'}`}
                    >
                      <Trash2 size={12} />
                      Delete
                    </button>
                  )
                )}
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={onClose}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDark ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-zinc-100'}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !content.trim()}
                  className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${isDark ? 'bg-blue-500 text-white hover:bg-blue-400 disabled:opacity-60' : 'bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60'}`}
                >
                  {saving && <Loader2 size={11} className="animate-spin" />}
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <div className="ml-auto">
              <button
                type="button"
                onClick={onClose}
                className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${isDark ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}
              >
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
