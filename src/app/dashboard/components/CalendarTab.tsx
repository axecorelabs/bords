'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventInput, EventClickArg } from '@fullcalendar/core'
import {
  Loader2,
  CalendarDays,
  X,
  Flag,
  Clock,
  CheckCircle2,
  LayoutGrid,
  CheckSquare,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

/* ── Task shape (same as InboxTab) ── */
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

const PRIORITY_COLORS = {
  high:   { bg: '#ef4444', border: '#dc2626', text: '#fff' },
  normal: { bg: '#3b82f6', border: '#2563eb', text: '#fff' },
  low:    { bg: '#6b7280', border: '#4b5563', text: '#fff' },
} as const

const COMPLETED_COLOR = { bg: '#22c55e', border: '#16a34a', text: '#fff' }

function sourceIcon(sourceType: string) {
  if (sourceType === 'kanban_task') return <LayoutGrid size={14} />
  return <CheckSquare size={14} />
}

/* ── CalendarTab component ── */
export default function CalendarTab({
  isDark,
  orgId,
}: {
  isDark: boolean
  orgId?: string // undefined = personal context
}) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTask, setSelectedTask] = useState<TaskItem | null>(null)
  const calendarRef = useRef<FullCalendar>(null)

  const fetchTasks = useCallback(async () => {
    try {
      setIsLoading(true)
      const res = await fetch('/api/execution/tasks')
      if (!res.ok) throw new Error('Failed to load tasks')
      const data = await res.json()

      let allTasks: TaskItem[] = []
      if (orgId) {
        const orgGroup = (data.tasksByOrganization || []).find(
          (g: OrgTaskGroup) => g.organization._id === orgId
        )
        allTasks = orgGroup?.tasks || []
      } else {
        allTasks = data.personalTasks || []
      }
      setTasks(allTasks)
    } catch {
      // Silently fail — empty calendar is fine
    } finally {
      setIsLoading(false)
    }
  }, [orgId])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  /* Map tasks → FullCalendar events */
  const events: EventInput[] = tasks.map((t) => {
    const isCompleted = t.status === 'completed'
    const colors = isCompleted
      ? COMPLETED_COLOR
      : PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.normal

    // Tasks without a due date get placed on their creation date
    const date = t.dueDate || t.createdAt

    return {
      id: t._id,
      title: t.content,
      start: date,
      allDay: true,
      backgroundColor: colors.bg,
      borderColor: colors.border,
      textColor: colors.text,
      classNames: isCompleted ? ['calendar-event-completed'] : [],
      extendedProps: { task: t },
    }
  })

  const handleEventClick = (info: EventClickArg) => {
    const task = info.event.extendedProps.task as TaskItem
    setSelectedTask(task)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={28} className="animate-spin text-blue-500" />
      </div>
    )
  }

  const tasksWithDue = tasks.filter((t) => t.dueDate)
  const noDueTasks = tasks.filter((t) => !t.dueDate)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            Calendar
          </h1>
          <p className={`text-sm mt-1 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            {tasksWithDue.length} task{tasksWithDue.length !== 1 ? 's' : ''} with deadlines
            {noDueTasks.length > 0 && (
              <span className={isDark ? 'text-zinc-500' : 'text-zinc-400'}>
                {' '}· {noDueTasks.length} without deadlines
              </span>
            )}
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4">
          {(['high', 'normal', 'low'] as const).map((p) => (
            <div key={p} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: PRIORITY_COLORS[p].bg }}
              />
              <span className={`text-xs capitalize ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                {p}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COMPLETED_COLOR.bg }} />
            <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>Done</span>
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className={`rounded-2xl border overflow-hidden ${
        isDark
          ? 'bg-zinc-800/50 border-zinc-700/60 fc-dark'
          : 'bg-white border-zinc-200'
      }`}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek',
          }}
          events={events}
          eventClick={handleEventClick}
          height="auto"
          dayMaxEvents={3}
          nowIndicator
          eventDisplay="block"
          eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
        />
      </div>

      {/* Task detail popup */}
      <AnimatePresence>
        {selectedTask && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center"
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedTask(null)} />
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
              <div className={`flex items-center justify-between px-5 py-4 border-b ${
                isDark ? 'border-zinc-700/60' : 'border-zinc-100'
              }`}>
                <div className="flex items-center gap-2">
                  {sourceIcon(selectedTask.sourceType)}
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    selectedTask.status === 'completed'
                      ? 'bg-green-500/15 text-green-500'
                      : 'bg-blue-500/15 text-blue-500'
                  }`}>
                    {selectedTask.status === 'completed' ? 'Completed' : 'Assigned'}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedTask(null)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    isDark ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'
                  }`}
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="px-5 py-4 space-y-4">
                <p className={`text-sm font-medium leading-relaxed ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                  {selectedTask.content}
                </p>

                <div className="space-y-2.5">
                  {/* Priority */}
                  <div className="flex items-center gap-2">
                    <Flag
                      size={14}
                      style={{ color: PRIORITY_COLORS[selectedTask.priority].bg }}
                    />
                    <span className={`text-xs capitalize ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                      {selectedTask.priority} priority
                    </span>
                  </div>

                  {/* Due date */}
                  {selectedTask.dueDate && (
                    <div className="flex items-center gap-2">
                      <Clock size={14} className={isDark ? 'text-zinc-500' : 'text-zinc-400'} />
                      <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        Due {new Date(selectedTask.dueDate).toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
                        })}
                      </span>
                    </div>
                  )}

                  {/* Board */}
                  {selectedTask.bordTitle && (
                    <div className="flex items-center gap-2">
                      <CalendarDays size={14} className={isDark ? 'text-zinc-500' : 'text-zinc-400'} />
                      <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        {selectedTask.bordTitle}
                      </span>
                    </div>
                  )}

                  {/* Column */}
                  {selectedTask.columnTitle && (
                    <div className="flex items-center gap-2">
                      <LayoutGrid size={14} className={isDark ? 'text-zinc-500' : 'text-zinc-400'} />
                      <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        Column: {selectedTask.columnTitle}
                      </span>
                    </div>
                  )}

                  {/* Completed at */}
                  {selectedTask.completedAt && (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={14} className="text-green-500" />
                      <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        Completed {new Date(selectedTask.completedAt).toLocaleDateString('en-US', {
                          weekday: 'short', month: 'short', day: 'numeric',
                        })}
                      </span>
                    </div>
                  )}

                  {/* Assigner */}
                  {selectedTask.assigner && (
                    <div className="flex items-center gap-2">
                      <div className={`w-3.5 h-3.5 rounded-full ${isDark ? 'bg-zinc-600' : 'bg-zinc-300'}`} />
                      <span className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                        From {selectedTask.assigner.firstName} {selectedTask.assigner.lastName}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
