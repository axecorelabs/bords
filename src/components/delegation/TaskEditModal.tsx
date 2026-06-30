'use client'

import { useState, useEffect } from 'react'
import {
  X, Loader2, Flag, Calendar, MessageSquare, Trash2,
  AlertCircle, Pencil, History, ChevronDown, ChevronUp,
} from 'lucide-react'

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
  currentUserId: string
  onClose: () => void
  onSaved: (updates: { text?: string; dueDate?: string | null; priority?: string; executionNote?: string | null }) => void
  onDeleted: () => void
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  assigned: { label: 'Assigned', color: 'text-blue-500' },
  edited:   { label: 'Edited',   color: 'text-amber-500' },
  completed:{ label: 'Completed',color: 'text-emerald-500' },
  reopened: { label: 'Reopened', color: 'text-violet-500' },
  deleted:  { label: 'Deleted',  color: 'text-red-500' },
}

const CHANGE_LABELS: Record<string, string> = {
  content: 'Title',
  dueDate: 'Due Date',
  priority: 'Priority',
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

export default function TaskEditModal({
  task, isDark, currentUserId, onClose, onSaved, onDeleted,
}: TaskEditModalProps) {
  const [content, setContent] = useState(task.text)
  const [dueDate, setDueDate] = useState(
    task.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : ''
  )
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>(
    (task.priority as 'low' | 'normal' | 'high') || 'normal'
  )
  const [executionNote, setExecutionNote] = useState(task.executionNote ?? '')
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)

  const isAssignment = task.source === 'assignment'
  const isAssigner = task.assignedBy === currentUserId
  const canEditOwnerFields = isAssigner

  useEffect(() => {
    if (!isAssignment) { setActivityLoading(false); return }
    ;(async () => {
      try {
        const res = await fetch(`/api/execution/tasks/${task.itemId}/activity`)
        if (!res.ok) return
        const data = await res.json()
        setActivity(data.activity || [])
        // Prefill executionNote from the server (most up-to-date)
        if (data.executionNote !== undefined) setExecutionNote(data.executionNote ?? '')
        if (data.priority) setPriority(data.priority)
        if (data.dueDate) setDueDate(new Date(data.dueDate).toISOString().split('T')[0])
      } catch {
        // silent
      } finally {
        setActivityLoading(false)
      }
    })()
  }, [task.itemId, isAssignment])

  const handleSave = async () => {
    if (!content.trim()) { setError('Title cannot be empty'); return }
    setSaving(true)
    setError('')
    try {
      const body: Record<string, any> = { content: content.trim() }
      if (canEditOwnerFields) {
        body.dueDate = dueDate || null
        body.priority = priority
        body.executionNote = executionNote.trim() || null
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
        dueDate: canEditOwnerFields ? (dueDate || null) : task.dueDate,
        priority: canEditOwnerFields ? priority : (task.priority as any),
        executionNote: canEditOwnerFields ? (executionNote.trim() || null) : task.executionNote,
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
    bg: isDark ? 'bg-zinc-900' : 'bg-white',
    border: isDark ? 'border-zinc-700/60' : 'border-zinc-200',
    text: isDark ? 'text-white' : 'text-zinc-900',
    muted: isDark ? 'text-zinc-400' : 'text-zinc-500',
    input: isDark
      ? 'bg-zinc-800/60 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-blue-500'
      : 'bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400 focus:border-blue-400',
    section: isDark ? 'bg-zinc-800/40' : 'bg-zinc-50',
  }

  const PRIORITY_OPTIONS: { value: 'low' | 'normal' | 'high'; label: string; active: string; inactive: string }[] = [
    {
      value: 'low', label: 'Low',
      active: isDark ? 'bg-blue-500/20 text-blue-400 ring-1 ring-blue-500/40' : 'bg-blue-50 text-blue-600 ring-1 ring-blue-200',
      inactive: isDark ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
    },
    {
      value: 'normal', label: 'Normal',
      active: isDark ? 'bg-zinc-600 text-white ring-1 ring-zinc-500' : 'bg-zinc-200 text-zinc-800 ring-1 ring-zinc-300',
      inactive: isDark ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
    },
    {
      value: 'high', label: 'High',
      active: isDark ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/40' : 'bg-red-50 text-red-600 ring-1 ring-red-200',
      inactive: isDark ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200',
    },
  ]

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
              <Pencil size={14} className={c.muted} />
            </div>
            <div>
              <h3 className={`text-sm font-semibold ${c.text}`}>Edit Task</h3>
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

          {/* Owner-only fields */}
          {canEditOwnerFields && (
            <>
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

              {/* Description */}
              <div>
                <label className={`block text-xs font-medium mb-1.5 ${c.muted}`}>
                  <MessageSquare size={11} className="inline mr-1" />Description
                  <span className="font-normal opacity-60 ml-1">(optional)</span>
                </label>
                <textarea
                  value={executionNote}
                  onChange={(e) => setExecutionNote(e.target.value)}
                  placeholder="Add context or instructions..."
                  rows={3}
                  className={`w-full rounded-lg border px-3 py-2 text-sm resize-none outline-none transition-colors ${c.input}`}
                />
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
          {/* Delete — only for assignment tasks where current user is assigner */}
          <div className="flex items-center gap-2">
            {isAssignment && isAssigner && (
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
        </div>
      </div>
    </div>
  )
}
