'use client'
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckSquare, LayoutGrid, Sparkles } from 'lucide-react'
import { useSession } from '@/components/AuthProvider'
import { useThemeStore } from '@/store/themeStore'
import { useBoardStore } from '@/store/boardStore'
import { useChecklistStore } from '@/store/checklistStore'
import { useKanbanStore } from '@/store/kanbanStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { useZIndexStore } from '@/store/zIndexStore'

type Template = 'blank' | 'todo' | 'kanban'

interface NewBoardModalProps {
  isOpen: boolean
  onClose: () => void
}

const TEMPLATES: { id: Template; label: string; description: string; icon: typeof Sparkles }[] = [
  { id: 'blank', label: 'Blank Canvas', description: 'Start from scratch', icon: Sparkles },
  { id: 'todo', label: 'Simple To-Do', description: 'A checklist to track tasks', icon: CheckSquare },
  { id: 'kanban', label: 'Kanban Board', description: 'Organize with columns', icon: LayoutGrid },
]

export function NewBoardModal({ isOpen, onClose }: NewBoardModalProps) {
  const { data: session } = useSession()
  const isDark = useThemeStore((s) => s.isDark)
  const addBoard = useBoardStore((s) => s.addBoard)
  const setCurrentBoard = useBoardStore((s) => s.setCurrentBoard)
  const addItemToBoard = useBoardStore((s) => s.addItemToBoard)
  const addChecklist = useChecklistStore((s) => s.addChecklist)
  const addKanban = useKanbanStore((s) => s.addBoard)
  const bringToFront = useZIndexStore((s) => s.bringToFront)

  const [boardName, setBoardName] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<Template>('blank')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setBoardName('')
      setSelectedTemplate('blank')
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  const handleCreate = () => {
    if (!boardName.trim() || !session?.user?.email) return

    const ctx = useWorkspaceStore.getState().activeContext
    const context = ctx?.type === 'organization'
      ? { contextType: 'organization' as const, organizationId: ctx.organizationId }
      : { contextType: 'personal' as const }

    const newBoardId = addBoard(boardName.trim(), session.user.email, context)
    setCurrentBoard(newBoardId)
    try { localStorage.setItem('bords-last-board', newBoardId) } catch {}

    // Pre-populate based on template
    if (selectedTemplate === 'todo') {
      const checklistId = Date.now().toString()
      addChecklist({
        id: checklistId,
        title: 'My Tasks',
        items: [
          { id: `${checklistId}-1`, text: 'First task', completed: false, timeSpent: 0, isTracking: false },
          { id: `${checklistId}-2`, text: 'Second task', completed: false, timeSpent: 0, isTracking: false },
          { id: `${checklistId}-3`, text: 'Third task', completed: false, timeSpent: 0, isTracking: false },
        ],
        position: { x: 200, y: 200 },
        color: 'bg-amber-100/90',
        createdAt: new Date().toISOString(),
      })
      bringToFront(checklistId)
      addItemToBoard(newBoardId, 'checklists', checklistId)
    } else if (selectedTemplate === 'kanban') {
      const kanbanId = Date.now().toString()
      addKanban({
        id: kanbanId,
        title: 'Project Board',
        color: 'bg-blue-100/90',
        position: { x: 100, y: 200 },
        columns: [
          { id: `${kanbanId}-col-0`, title: 'To Do', tasks: [] },
          { id: `${kanbanId}-col-1`, title: 'In Progress', tasks: [] },
          { id: `${kanbanId}-col-2`, title: 'Done', tasks: [] },
        ],
        width: 800,
        height: 400,
      })
      bringToFront(kanbanId)
      addItemToBoard(newBoardId, 'kanbans', kanbanId)
    }

    onClose()
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center"
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className={`relative w-full max-w-md mx-4 rounded-2xl border shadow-2xl ${
              isDark ? 'bg-zinc-900 border-zinc-700/60' : 'bg-white border-zinc-200'
            }`}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-6 py-4 border-b ${
              isDark ? 'border-zinc-700/60' : 'border-zinc-100'
            }`}>
              <h2 className={`text-lg font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                New Board
              </h2>
              <button
                onClick={onClose}
                className={`p-1.5 rounded-lg transition-colors ${
                  isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'
                }`}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5 space-y-5">
              {/* Board name */}
              <div>
                <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  Board name
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={boardName}
                  onChange={(e) => setBoardName(e.target.value)}
                  placeholder="e.g. Marketing Sprint, Personal Tasks…"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && boardName.trim()) handleCreate()
                    if (e.key === 'Escape') onClose()
                  }}
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${
                    isDark
                      ? 'bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-500'
                      : 'bg-white border-zinc-200 text-zinc-900 placeholder:text-zinc-400'
                  }`}
                />
              </div>

              {/* Template selector */}
              <div>
                <label className={`block text-sm font-medium mb-2 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  Start with…
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {TEMPLATES.map((tpl) => {
                    const isActive = selectedTemplate === tpl.id
                    const Icon = tpl.icon
                    return (
                      <button
                        key={tpl.id}
                        onClick={() => setSelectedTemplate(tpl.id)}
                        className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all text-center ${
                          isActive
                            ? isDark
                              ? 'border-blue-500 bg-blue-500/10'
                              : 'border-blue-500 bg-blue-50'
                            : isDark
                              ? 'border-zinc-700/60 hover:border-zinc-600 bg-zinc-800/50'
                              : 'border-zinc-200 hover:border-zinc-300 bg-zinc-50/50'
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                          isActive
                            ? isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'
                            : isDark ? 'bg-zinc-700 text-zinc-400' : 'bg-zinc-200 text-zinc-500'
                        }`}>
                          <Icon size={18} />
                        </div>
                        <div>
                          <p className={`text-xs font-semibold ${
                            isActive
                              ? isDark ? 'text-blue-400' : 'text-blue-600'
                              : isDark ? 'text-zinc-200' : 'text-zinc-700'
                          }`}>{tpl.label}</p>
                          <p className={`text-[10px] mt-0.5 ${
                            isDark ? 'text-zinc-500' : 'text-zinc-400'
                          }`}>{tpl.description}</p>
                        </div>
                        {isActive && (
                          <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-500" />
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className={`flex items-center justify-end gap-2.5 px-6 py-4 border-t ${
              isDark ? 'border-zinc-700/60' : 'border-zinc-100'
            }`}>
              <button
                onClick={onClose}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                  isDark ? 'text-zinc-400 hover:bg-zinc-800' : 'text-zinc-600 hover:bg-zinc-100'
                }`}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!boardName.trim()}
                className={`px-5 py-2 rounded-xl text-sm font-semibold transition-colors ${
                  boardName.trim()
                    ? 'bg-blue-600 hover:bg-blue-700 text-white'
                    : isDark
                      ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                      : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
                }`}
              >
                Create Board
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
