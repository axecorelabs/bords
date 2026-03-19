'use client'
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Calendar } from 'lucide-react'
import type { KanbanTask } from '../types/kanban'
import { useThemeStore } from '../store/themeStore'
import { useWorkspaceStore } from '../store/workspaceStore'

const priorityColors = {
  low: 'bg-blue-500',
  medium: 'bg-yellow-500',
  high: 'bg-red-500',
}

interface AddTaskModalProps {
  isOpen: boolean
  columnTitle: string
  onAdd: (task: KanbanTask, assignAfter: boolean) => void
  onClose: () => void
}

export function AddTaskModal({ isOpen, columnTitle, onAdd, onClose }: AddTaskModalProps) {
  const isDark = useThemeStore((state) => state.isDark)
  const isOrgContext = useWorkspaceStore((s) => s.isOrgContext())
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium')
  const [dueDate, setDueDate] = useState('')
  const [assignOnCreate, setAssignOnCreate] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setTitle('')
      setDescription('')
      setPriority('medium')
      setDueDate('')
      setAssignOnCreate(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSubmit = () => {
    if (!title.trim()) return
    onAdd(
      {
        id: Date.now().toString(),
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        dueDate: dueDate || undefined,
      },
      assignOnCreate,
    )
    onClose()
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      style={{ touchAction: 'auto' }}
      onClick={onClose}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <div
        className={`w-full max-w-md mx-4 rounded-2xl shadow-2xl border overflow-hidden max-h-[85vh] flex flex-col ${
          isDark
            ? 'bg-zinc-900 border-zinc-700/60'
            : 'bg-white border-zinc-200/60'
        }`}
        style={{ touchAction: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${
          isDark ? 'border-zinc-700/50' : 'border-zinc-100'
        }`}>
          <div>
            <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Add Task</h3>
            <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
              Adding to <span className={`font-medium ${isDark ? 'text-zinc-300' : 'text-gray-600'}`}>{columnTitle}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-zinc-700' : 'hover:bg-gray-100'}`}
          >
            <X size={18} className={isDark ? 'text-zinc-400' : 'text-gray-400'} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>Title</label>
            <input
              ref={inputRef}
              type="text"
              placeholder="What needs to be done?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={`w-full px-3.5 py-2.5 text-sm rounded-xl border focus:ring-2 focus:ring-blue-400/50 focus:border-blue-300 focus:outline-none transition-all ${
                isDark
                  ? 'border-zinc-700 bg-zinc-800 text-white placeholder:text-zinc-500 focus:bg-zinc-800'
                  : 'border-zinc-200 bg-zinc-50/50 text-gray-900 placeholder:text-gray-400 focus:bg-white'
              }`}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && title.trim()) handleSubmit()
                if (e.key === 'Escape') onClose()
              }}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>Description <span className={isDark ? 'text-zinc-600' : 'text-gray-300'}>(optional)</span></label>
            <textarea
              placeholder="Add more details…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={`w-full px-3.5 py-2.5 text-sm rounded-xl border focus:ring-2 focus:ring-blue-400/50 focus:border-blue-300 focus:outline-none resize-none transition-all ${
                isDark
                  ? 'border-zinc-700 bg-zinc-800 text-white placeholder:text-zinc-500 focus:bg-zinc-800'
                  : 'border-zinc-200 bg-zinc-50/50 text-gray-900 placeholder:text-gray-400 focus:bg-white'
              }`}
              rows={3}
              onKeyDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </div>

          {/* Priority */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>Priority</label>
            <div className="flex gap-2">
              {(['low', 'medium', 'high'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`flex-1 px-3 py-2 text-sm rounded-xl capitalize transition-all font-medium ${
                    priority === p
                      ? `${priorityColors[p]} text-white shadow-md`
                      : isDark ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-zinc-100 text-gray-600 hover:bg-zinc-200'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Due date */}
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>Due Date</label>
            <div className="flex items-center gap-2">
              <Calendar size={16} className={`shrink-0 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`} />
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={`flex-1 px-3.5 py-2 text-sm rounded-xl border focus:ring-2 focus:ring-blue-400/50 focus:border-blue-300 focus:outline-none transition-all ${
                  isDark
                    ? 'border-zinc-700 bg-zinc-800 text-white focus:bg-zinc-800'
                    : 'border-zinc-200 bg-zinc-50/50 text-gray-900 focus:bg-white'
                }`}
                onKeyDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              />
              {dueDate && (
                <button
                  onClick={() => setDueDate('')}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={`p-1.5 rounded-lg transition-colors ${isDark ? 'hover:bg-zinc-700' : 'hover:bg-gray-100'}`}
                  title="Clear date"
                >
                  <X size={14} className={isDark ? 'text-zinc-400' : 'text-gray-400'} />
                </button>
              )}
            </div>
          </div>

          {/* Assign toggle */}
          <button
            type="button"
            onClick={() => setAssignOnCreate(!assignOnCreate)}
            onPointerDown={(e) => e.stopPropagation()}
            className={`flex items-center gap-2 w-full px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all border ${
              assignOnCreate
                ? isDark ? 'bg-emerald-900/40 border-emerald-600 text-emerald-400' : 'bg-emerald-50 border-emerald-300 text-emerald-700'
                : isDark ? 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600' : 'bg-zinc-50/50 border-zinc-200 text-gray-500 hover:border-zinc-300 hover:bg-zinc-100/50'
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <line x1="19" y1="8" x2="19" y2="14"/>
              <line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
            {assignOnCreate ? 'Will assign after create' : isOrgContext ? 'Assign to employee' : 'Assign to friend'}
          </button>
        </div>

        {/* Footer */}
        <div className={`flex gap-3 px-5 py-4 border-t ${isDark ? 'border-zinc-700/50 bg-zinc-900/50' : 'border-zinc-100 bg-zinc-50/50'}`}>
          <button
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            className={`flex-1 px-4 py-2.5 text-sm font-medium rounded-xl border transition-all ${
              isDark ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-zinc-200 text-gray-700 hover:bg-zinc-100'
            }`}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!title.trim()}
            className="flex-1 px-4 py-2.5 text-sm font-semibold rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add Task
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
