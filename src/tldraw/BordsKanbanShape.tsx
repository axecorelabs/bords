'use client'
import {
  ShapeUtil,
  HTMLContainer,
  resizeBox,
  TLResizeInfo,
  RecordProps,
  T,
  Rectangle2d,
  useEditor,
  type SvgExportContext,
} from 'tldraw'
import { useState, useCallback, useRef, useMemo } from 'react'
import { Trash2, Palette, GripVertical, Plus, Check, X, Circle, Calendar, Pencil } from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal'
import { AddTaskModal } from '@/components/AddTaskModal'
import { ConnectionLinkButton, ConnectionSelectionRing, ConnectionIndicator } from './ConnectionLink'
import { AssignButton } from '@/components/delegation/AssignButton'
import { useKanbanStore } from '@/store/kanbanStore'
import { resolveColor, truncateText } from './bordsShapeTypes'
import type { BordsKanban } from './bordsShapeTypes'
import type { KanbanTask } from '@/types/kanban'

/* ── Priority colors ── */
const PRIORITY_COLORS: Record<string, string> = {
  low: '#3b82f6',
  medium: '#eab308',
  high: '#ef4444',
}

const PRIORITY_BG: Record<string, string> = {
  low: 'bg-blue-500',
  medium: 'bg-yellow-500',
  high: 'bg-red-500',
}

/** Compare at date level — today is NOT overdue */
function isOverdue(dateStr: string): boolean {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dateStr + 'T00:00:00')
  return due < today
}

/* ── Shape Util ── */
export class BordsKanbanUtil extends ShapeUtil<BordsKanban> {
  static override type = 'bords-kanban' as const

  static override props: RecordProps<BordsKanban> = {
    w: T.number,
    h: T.number,
    title: T.string,
    color: T.string,
    kanbanId: T.string,
  }

  getDefaultProps(): BordsKanban['props'] {
    return {
      w: 800,
      h: 400,
      title: 'Kanban Board',
      color: 'bg-white/90',
      kanbanId: '',
    }
  }

  getGeometry(shape: BordsKanban) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  component(shape: BordsKanban) {
    return <KanbanComponent shape={shape} />
  }

  indicator(shape: BordsKanban) {
    return (
      <rect rx={16} ry={16} width={shape.props.w} height={shape.props.h} fill="none" />
    )
  }

  override canResize() { return true }

  override onResize(shape: BordsKanban, info: TLResizeInfo<any>) {
    return resizeBox(shape as any, info)
  }

  override canEdit() { return true }

  /* ── SVG export — pure SVG, no foreignObject ── */
  override toSvg(shape: BordsKanban, _ctx: SvgExportContext) {
    const { w, h, title, color, kanbanId } = shape.props
    const bgColor = resolveColor(color)
    const board = useKanbanStore.getState().boards.find((b) => b.id === kanbanId)
    const columns = board?.columns || []
    const headerH = 48
    const colHeaderH = 32
    const taskH = 30
    const pad = 12
    const fontSize = 12
    const colCount = Math.max(1, columns.length)
    const colW = (w - pad * 2) / colCount
    const gap = 8

    return (
      <g>
        {/* Background */}
        <rect width={w} height={h} rx={16} ry={16} fill={bgColor} />
        {/* Title */}
        <text x={pad + 4} y={32} fontSize={16} fontWeight="bold" fill="#1f2937" fontFamily="system-ui, -apple-system, sans-serif">
          {truncateText(title, w - pad * 2, 16)}
        </text>
        {/* Columns */}
        {columns.map((col, ci) => {
          const cx = pad + ci * colW + gap / 2
          const cw = colW - gap
          const maxTasks = Math.floor((h - headerH - colHeaderH - pad) / taskH)
          const visibleTasks = col.tasks.slice(0, maxTasks)
          return (
            <g key={col.id}>
              {/* Column background */}
              <rect x={cx} y={headerH} width={cw} height={h - headerH - pad} rx={8} ry={8} fill="rgba(0,0,0,0.04)" />
              {/* Column header */}
              <text x={cx + 8} y={headerH + 20} fontSize={13} fontWeight="600" fill="#374151" fontFamily="system-ui, -apple-system, sans-serif">
                {truncateText(col.title, cw - 16, 13)}
              </text>
              <text x={cx + cw - 8} y={headerH + 20} fontSize={11} fill="#9ca3af" textAnchor="end" fontFamily="system-ui, sans-serif">
                {col.tasks.length}
              </text>
              {/* Tasks */}
              {visibleTasks.map((task, ti) => {
                const ty = headerH + colHeaderH + ti * taskH
                const priColor = task.priority ? (PRIORITY_COLORS[task.priority] || '#6b7280') : null
                return (
                  <g key={task.id}>
                    <rect x={cx + 4} y={ty} width={cw - 8} height={taskH - 4} rx={6} ry={6} fill="#fff" stroke="#e5e7eb" strokeWidth={1} />
                    {priColor && <circle cx={cx + 14} cy={ty + (taskH - 4) / 2} r={3} fill={priColor} />}
                    <text x={cx + (priColor ? 24 : 12)} y={ty + (taskH - 4) / 2 + 4} fontSize={fontSize} fill={task.completed ? '#9ca3af' : '#374151'}
                      textDecoration={task.completed ? 'line-through' : 'none'}
                      fontFamily="system-ui, -apple-system, sans-serif">
                      {truncateText(task.title, cw - 36, fontSize)}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </g>
    )
  }
}

/* ── Component ── */
function KanbanComponent({ shape }: { shape: BordsKanban }) {
  const editor = useEditor()
  const { title, color, w, h, kanbanId } = shape.props
  const [showControls, setShowControls] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(title)
  const [newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null)
  const [showAddColumn, setShowAddColumn] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editColumnTitle, setEditColumnTitle] = useState('')
  const [columnToDelete, setColumnToDelete] = useState<string | null>(null)
  const [taskToDelete, setTaskToDelete] = useState<{
    columnId: string; taskId: string; title: string
  } | null>(null)
  const [editingTaskData, setEditingTaskData] = useState<{
    columnId: string; taskId: string; title: string; description: string
    priority: 'low' | 'medium' | 'high'; dueDate: string
  } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // ── Pointer-based task drag (between columns) ──
  const [dropTarget, setDropTarget] = useState<{ columnId: string; index: number } | null>(null)
  const pointerDragRef = useRef<{
    task: KanbanTask
    columnId: string
    startX: number
    startY: number
    pointerId: number
    ghostEl: HTMLDivElement | null
    sourceEl: HTMLElement | null
    isDragging: boolean
  } | null>(null)
  const DRAG_THRESHOLD = 5

  // Read kanban board from Zustand store
  const kanban = useKanbanStore((s) => s.boards.find((b) => b.id === kanbanId))
  const columns = kanban?.columns || []
  const addTask = useKanbanStore((s) => s.addTask)
  const updateTask = useKanbanStore((s) => s.updateTask)
  const deleteTask = useKanbanStore((s) => s.deleteTask)
  const addColumn = useKanbanStore((s) => s.addColumn)
  const updateColumn = useKanbanStore((s) => s.updateColumn)
  const deleteColumn = useKanbanStore((s) => s.deleteColumn)

  const bgColor = resolveColor(color)

  const handleTitleSave = useCallback(() => {
    setIsEditingTitle(false)
    if (editTitle !== title) {
      editor.updateShape({
        id: shape.id,
        type: 'bords-kanban',
        props: { title: editTitle },
      })
      useKanbanStore.getState().updateBoardTitle(kanbanId, editTitle)
    }
  }, [editor, shape.id, editTitle, title, kanbanId])

  const handleColorChange = useCallback((newColor: string) => {
    editor.updateShape({
      id: shape.id,
      type: 'bords-kanban',
      props: { color: newColor },
    })
    useKanbanStore.getState().updateBoardColor(kanbanId, newColor)
  }, [editor, shape.id, kanbanId])

  const handleDelete = useCallback(() => {
    editor.deleteShape(shape.id)
    setShowDeleteConfirm(false)
  }, [editor, shape.id])

  const handleAddColumn = useCallback(() => {
    if (!kanbanId) return
    if (showAddColumn && newColumnTitle.trim()) {
      addColumn(kanbanId, {
        id: crypto.randomUUID(),
        title: newColumnTitle.trim(),
        tasks: [],
      })
      setNewColumnTitle('')
      setShowAddColumn(false)
    } else {
      setShowAddColumn(true)
    }
  }, [kanbanId, addColumn, showAddColumn, newColumnTitle])

  const handleAddTask = (columnId: string, task: KanbanTask, _assignAfter: boolean) => {
    addTask(kanbanId, columnId, task)
    setNewTaskColumnId(null)
  }

  const saveEditingTask = () => {
    if (!editingTaskData) return
    if (editingTaskData.title.trim()) {
      updateTask(kanbanId, editingTaskData.columnId, editingTaskData.taskId, {
        title: editingTaskData.title.trim(),
        description: editingTaskData.description.trim() || undefined,
        priority: editingTaskData.priority,
        dueDate: editingTaskData.dueDate || undefined,
      })
    }
    setEditingTaskData(null)
  }

  const moveTask = useKanbanStore((s) => s.moveTask)

  const handleTaskPointerDown = useCallback(
    (e: React.PointerEvent, task: KanbanTask, columnId: string) => {
      if (e.button !== 0) return
      if (editingTaskData?.taskId === task.id) return
      e.stopPropagation()
      e.preventDefault()
      const sourceEl = e.currentTarget as HTMLElement
      sourceEl.setPointerCapture(e.pointerId)
      pointerDragRef.current = {
        task, columnId,
        startX: e.clientX, startY: e.clientY,
        pointerId: e.pointerId,
        ghostEl: null, sourceEl, isDragging: false,
      }
    },
    [editingTaskData],
  )

  const handleTaskPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = pointerDragRef.current
      if (!drag) return
      e.stopPropagation()
      e.preventDefault()
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.isDragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        drag.isDragging = true
        const ghost = document.createElement('div')
        ghost.className = 'fixed pointer-events-none z-[99999]'
        Object.assign(ghost.style, {
          padding: '8px 12px', borderRadius: '10px',
          border: '1px solid rgba(59,130,246,0.3)',
          background: 'white', boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          opacity: '0.92', fontSize: '12px', fontWeight: '500',
          color: '#1f2937', maxWidth: '200px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          left: `${e.clientX - 40}px`, top: `${e.clientY - 15}px`,
        })
        ghost.textContent = drag.task.title
        document.body.appendChild(ghost)
        drag.ghostEl = ghost
        if (drag.sourceEl) drag.sourceEl.style.opacity = '0.3'
      }
      if (drag.ghostEl) {
        drag.ghostEl.style.left = `${e.clientX - 40}px`
        drag.ghostEl.style.top = `${e.clientY - 15}px`
      }
      // Hit-test drop target
      if (drag.ghostEl) drag.ghostEl.style.display = 'none'
      const elBelow = document.elementFromPoint(e.clientX, e.clientY)
      if (drag.ghostEl) drag.ghostEl.style.display = ''
      if (elBelow) {
        const colEl = elBelow.closest('[data-kanban-column]') as HTMLElement
        if (colEl) {
          const colId = colEl.dataset.kanbanColumn!
          const taskEls = Array.from(colEl.querySelectorAll('[data-kanban-task]')) as HTMLElement[]
          let idx = taskEls.length
          for (let i = 0; i < taskEls.length; i++) {
            const rect = taskEls[i].getBoundingClientRect()
            if (e.clientY < rect.top + rect.height / 2) { idx = i; break }
          }
          setDropTarget({ columnId: colId, index: idx })
        } else {
          setDropTarget(null)
        }
      }
    },
    [],
  )

  const handleTaskPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const drag = pointerDragRef.current
      if (!drag) return
      e.stopPropagation()
      e.preventDefault()
      if (drag.ghostEl) { drag.ghostEl.remove(); drag.ghostEl = null }
      if (drag.sourceEl) drag.sourceEl.style.opacity = ''
      try { (e.currentTarget as HTMLElement).releasePointerCapture(drag.pointerId) } catch {}
      if (drag.isDragging && dropTarget) {
        moveTask(kanbanId, drag.task.id, drag.columnId, dropTarget.columnId, dropTarget.index)
      }
      pointerDragRef.current = null
      setDropTarget(null)
    },
    [kanbanId, dropTarget, moveTask],
  )

  const handleTaskPointerCancel = useCallback((e: React.PointerEvent) => {
    const drag = pointerDragRef.current
    if (!drag) return
    if (drag.ghostEl) { drag.ghostEl.remove(); drag.ghostEl = null }
    if (drag.sourceEl) drag.sourceEl.style.opacity = ''
    try { (e.currentTarget as HTMLElement).releasePointerCapture(drag.pointerId) } catch {}
    pointerDragRef.current = null
    setDropTarget(null)
  }, [])

  const colWidth = Math.max(200, Math.min(240, (w - 40) / Math.max(columns.length, 1) - 12))

  return (
    <HTMLContainer
      id={shape.id}
      style={{ width: w, height: h, pointerEvents: 'all' }}
    >
      <div
        data-node-id={kanbanId}
        data-item-id={kanbanId}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
        style={{ width: '100%', height: '100%', position: 'relative' }}
      >
        <ConnectionSelectionRing itemId={kanbanId} />
        {/* Label badge */}
        <div
          style={{
            position: 'absolute', top: -8, left: -8,
            background: 'linear-gradient(to right, #3f3f46, #52525b)',
            color: 'white', fontSize: 10, padding: '4px 8px',
            borderRadius: 9999, fontWeight: 500,
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)', zIndex: 2, pointerEvents: 'none',
          }}
        >
          Kanban
        </div>

        {/* Action toolbar */}
        {showControls && (
          <div
            style={{
              position: 'absolute', top: -8, right: -8,
              background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(12px)',
              borderRadius: 9999, boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              border: '1px solid rgba(0,0,0,0.1)',
              display: 'flex', overflow: 'hidden', zIndex: 10,
            }}
          >
            <button
              style={{ padding: 10, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Add column"
              onPointerDown={(e) => { e.stopPropagation(); handleAddColumn() }}
            >
              <Plus size={14} color="#059669" />
            </button>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <button
              style={{ padding: 10, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Change color"
              onPointerDown={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker) }}
            >
              <Palette size={14} color="#9333ea" />
            </button>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <ConnectionLinkButton itemId={kanbanId} itemType="kanban" />
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <button
              style={{ padding: 10, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Delete kanban"
              onPointerDown={(e) => { e.stopPropagation(); setShowDeleteConfirm(true) }}
            >
              <Trash2 size={14} color="#dc2626" />
            </button>
          </div>
        )}

        {/* Card body */}
        <div
          style={{
            width: '100%', height: '100%',
            backgroundColor: bgColor, borderRadius: 16,
            border: '1px solid rgba(0,0,0,0.1)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden', fontFamily: 'inherit',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 16px', display: 'flex', alignItems: 'center',
              gap: 8, borderBottom: '1px solid rgba(0,0,0,0.08)',
              flexShrink: 0,
            }}
          >
            <GripVertical size={14} style={{ color: '#9ca3af', flexShrink: 0 }} />
            {isEditingTitle ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === 'Escape') handleTitleSave()
                  e.stopPropagation()
                }}
                onPointerDown={(e) => e.stopPropagation()}
                style={{
                  flex: 1, border: '1px solid #3b82f6', borderRadius: 6,
                  padding: '2px 6px', fontSize: 14, fontWeight: 600,
                  outline: 'none', background: 'rgba(255,255,255,0.5)',
                  color: '#1f2937',
                }}
              />
            ) : (
              <span
                onDoubleClick={() => { setIsEditingTitle(true); setEditTitle(title) }}
                style={{
                  flex: 1, fontSize: 14, fontWeight: 600,
                  color: '#1f2937', cursor: 'text',
                }}
              >
                {title}
              </span>
            )}
            <span style={{ fontSize: 11, color: '#9ca3af' }}>
              {columns.reduce((acc, col) => acc + col.tasks.length, 0)} tasks
            </span>
          </div>

          {/* Columns area — horizontally scrollable */}
          <div
            ref={scrollRef}
            onWheel={(e) => {
              // Allow horizontal scrolling; stop tldraw from intercepting wheel events
              if (scrollRef.current) {
                const el = scrollRef.current
                const hasHScroll = el.scrollWidth > el.clientWidth
                if (hasHScroll) {
                  e.stopPropagation()
                  // If shift isn't held, convert vertical scroll to horizontal
                  if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
                    el.scrollLeft += e.deltaY
                  }
                }
              }
            }}
            style={{
              flex: 1, display: 'flex', gap: 8,
              padding: 12, overflowX: 'auto', overflowY: 'hidden',
              minHeight: 0,
              scrollbarWidth: 'thin' as const,
              scrollbarColor: '#d4d4d8 transparent',
            }}
          >
            {columns.map((col) => (
              <div
                key={col.id}
                style={{
                  width: colWidth, minWidth: colWidth, flexShrink: 0,
                  backgroundColor: 'rgba(244,244,245,0.8)',
                  borderRadius: 12, display: 'flex', flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                {/* Column header */}
                <div
                  style={{
                    padding: '8px 10px', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', borderBottom: '1px solid rgba(0,0,0,0.05)',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                    {editingColumnId === col.id ? (
                      <input
                        autoFocus
                        value={editColumnTitle}
                        onChange={(e) => setEditColumnTitle(e.target.value)}
                        onBlur={() => {
                          if (editColumnTitle.trim()) updateColumn(kanbanId, col.id, editColumnTitle.trim())
                          setEditingColumnId(null)
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation()
                          if (e.key === 'Enter' && editColumnTitle.trim()) {
                            updateColumn(kanbanId, col.id, editColumnTitle.trim())
                            setEditingColumnId(null)
                          }
                          if (e.key === 'Escape') setEditingColumnId(null)
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        style={{
                          flex: 1, border: '1px solid #3b82f6', borderRadius: 6,
                          padding: '1px 4px', fontSize: 12, fontWeight: 600,
                          outline: 'none', background: 'white', color: '#3f3f46',
                        }}
                      />
                    ) : (
                      <span
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          setEditColumnTitle(col.title)
                          setEditingColumnId(col.id)
                        }}
                        style={{
                          fontSize: 12, fontWeight: 600, color: '#3f3f46',
                          cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title="Double-click to rename"
                      >
                        {col.title}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 10, fontWeight: 600, color: '#71717a',
                        backgroundColor: 'rgba(255,255,255,0.8)',
                        padding: '1px 6px', borderRadius: 9999, flexShrink: 0,
                      }}
                    >
                      {col.tasks.length}
                    </span>
                  </div>
                  <button
                    onPointerDown={(e) => {
                      e.stopPropagation()
                      setColumnToDelete(col.id)
                    }}
                    style={{
                      padding: 3, border: 'none', background: 'none', cursor: 'pointer',
                      borderRadius: 6, flexShrink: 0, opacity: 0.5,
                    }}
                    title="Delete column"
                  >
                    <Trash2 size={12} color="#ef4444" />
                  </button>
                </div>

                {/* Scrollable tasks */}
                <div
                  data-kanban-column={col.id}
                  style={{
                    flex: 1, overflow: 'auto', padding: 6,
                    display: 'flex', flexDirection: 'column', gap: 4,
                    scrollbarWidth: 'thin', scrollbarColor: '#d4d4d8 transparent',
                    transition: 'background-color 0.15s',
                    backgroundColor: dropTarget?.columnId === col.id ? 'rgba(59,130,246,0.06)' : 'transparent',
                    borderRadius: 8,
                  }}
                >
                  {col.tasks.map((task) => (
                    <div
                      key={task.id}
                      data-kanban-task={task.id}
                      onPointerDown={(e) => handleTaskPointerDown(e, task, col.id)}
                      onPointerMove={handleTaskPointerMove}
                      onPointerUp={handleTaskPointerUp}
                      onPointerCancel={handleTaskPointerCancel}
                      style={{
                        padding: '8px 10px', borderRadius: 10,
                        backgroundColor: 'white',
                        border: '1px solid rgba(0,0,0,0.06)',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                        position: 'relative',
                        cursor: 'grab', touchAction: 'none',
                      }}
                    >
                      {/* ── Inline edit form ── */}
                      {editingTaskData?.taskId === task.id && editingTaskData?.columnId === col.id ? (
                        <div
                          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <input
                            autoFocus
                            value={editingTaskData.title}
                            onChange={(e) => setEditingTaskData({ ...editingTaskData, title: e.target.value })}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (e.key === 'Enter') saveEditingTask()
                              if (e.key === 'Escape') setEditingTaskData(null)
                            }}
                            style={{
                              width: '100%', padding: '4px 8px', fontSize: 12, borderRadius: 6,
                              border: '1px solid #d1d5db', outline: 'none', background: 'white',
                              color: '#1f2937',
                            }}
                          />
                          <textarea
                            value={editingTaskData.description}
                            onChange={(e) => setEditingTaskData({ ...editingTaskData, description: e.target.value })}
                            placeholder="Description..."
                            rows={2}
                            onKeyDown={(e) => e.stopPropagation()}
                            style={{
                              width: '100%', padding: '4px 8px', fontSize: 11, borderRadius: 6,
                              border: '1px solid #d1d5db', outline: 'none', resize: 'none',
                              background: 'white', color: '#1f2937',
                            }}
                          />
                          <div style={{ display: 'flex', gap: 4 }}>
                            {(['low', 'medium', 'high'] as const).map((p) => (
                              <button
                                key={p}
                                type="button"
                                onPointerDown={(e) => {
                                  e.stopPropagation()
                                  setEditingTaskData({ ...editingTaskData, priority: p })
                                }}
                                style={{
                                  padding: '2px 8px', fontSize: 10, borderRadius: 6,
                                  border: 'none', cursor: 'pointer', fontWeight: 600,
                                  textTransform: 'capitalize',
                                  background: editingTaskData.priority === p
                                    ? PRIORITY_COLORS[p] : '#f4f4f5',
                                  color: editingTaskData.priority === p ? 'white' : '#6b7280',
                                }}
                              >
                                {p}
                              </button>
                            ))}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Calendar size={12} color="#9ca3af" />
                            <input
                              type="date"
                              value={editingTaskData.dueDate}
                              onChange={(e) => setEditingTaskData({ ...editingTaskData, dueDate: e.target.value })}
                              onKeyDown={(e) => e.stopPropagation()}
                              style={{
                                flex: 1, padding: '2px 6px', fontSize: 11, borderRadius: 6,
                                border: '1px solid #d1d5db', outline: 'none',
                                background: 'white', color: '#1f2937',
                              }}
                            />
                            {editingTaskData.dueDate && (
                              <button
                                onPointerDown={(e) => {
                                  e.stopPropagation()
                                  setEditingTaskData({ ...editingTaskData, dueDate: '' })
                                }}
                                style={{ padding: 2, border: 'none', background: 'none', cursor: 'pointer' }}
                              >
                                <X size={10} color="#9ca3af" />
                              </button>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              onPointerDown={(e) => { e.stopPropagation(); saveEditingTask() }}
                              style={{
                                flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 600,
                                borderRadius: 6, border: 'none', cursor: 'pointer',
                                background: '#3b82f6', color: 'white',
                              }}
                            >
                              Save
                            </button>
                            <button
                              onPointerDown={(e) => { e.stopPropagation(); setEditingTaskData(null) }}
                              style={{
                                flex: 1, padding: '4px 0', fontSize: 11, fontWeight: 500,
                                borderRadius: 6, border: 'none', cursor: 'pointer',
                                background: '#f4f4f5', color: '#6b7280',
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* ── Task card display ── */
                        <>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                            <button
                              onPointerDown={(e) => {
                                e.stopPropagation()
                                updateTask(kanbanId, col.id, task.id, { completed: !task.completed })
                              }}
                              style={{
                                width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                                border: task.completed ? 'none' : '2px solid #d1d5db',
                                background: task.completed ? '#10b981' : 'white',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer', marginTop: 1,
                              }}
                            >
                              {task.completed && <Check size={10} color="white" strokeWidth={3} />}
                            </button>
                            <span
                              onDoubleClick={(e) => {
                                e.stopPropagation()
                                setEditingTaskData({
                                  columnId: col.id,
                                  taskId: task.id,
                                  title: task.title,
                                  description: task.description || '',
                                  priority: task.priority || 'medium',
                                  dueDate: task.dueDate || '',
                                })
                              }}
                              style={{
                                fontSize: 12, fontWeight: 500, flex: 1,
                                color: task.completed ? '#9ca3af' : '#1f2937',
                                textDecoration: task.completed ? 'line-through' : 'none',
                                cursor: 'text',
                              }}
                              title="Double-click to edit"
                            >
                              {task.title}
                            </span>
                            {/* Task actions */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                              <div onPointerDown={(e) => e.stopPropagation()}>
                                <AssignButton
                                  sourceType="kanban_task"
                                  sourceId={task.id}
                                  content={task.title}
                                  size={12}
                                  columnId={col.id}
                                  columnTitle={col.title}
                                  availableColumns={columns.map((c) => ({ id: c.id, title: c.title }))}
                                />
                              </div>
                              <button
                                onPointerDown={(e) => {
                                  e.stopPropagation()
                                  setEditingTaskData({
                                    columnId: col.id,
                                    taskId: task.id,
                                    title: task.title,
                                    description: task.description || '',
                                    priority: task.priority || 'medium',
                                    dueDate: task.dueDate || '',
                                  })
                                }}
                                style={{
                                  padding: 2, border: 'none', background: 'none', cursor: 'pointer',
                                  borderRadius: 4, opacity: 0.4,
                                }}
                                title="Edit task"
                              >
                                <Pencil size={10} color="#3b82f6" />
                              </button>
                              <button
                                onPointerDown={(e) => {
                                  e.stopPropagation()
                                  setTaskToDelete({ columnId: col.id, taskId: task.id, title: task.title })
                                }}
                                style={{
                                  padding: 2, border: 'none', background: 'none', cursor: 'pointer',
                                  borderRadius: 4, opacity: 0.4,
                                }}
                                title="Delete task"
                              >
                                <X size={10} color="#ef4444" />
                              </button>
                            </div>
                          </div>
                          {task.description && (
                            <p style={{
                              fontSize: 11, color: '#6b7280', marginTop: 4,
                              lineHeight: 1.3, overflow: 'hidden',
                              display: '-webkit-box', WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                            }}>
                              {task.description}
                            </p>
                          )}
                          {(task.priority || task.dueDate) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                              {task.priority && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <Circle
                                    size={8}
                                    fill={PRIORITY_COLORS[task.priority] || '#6b7280'}
                                    color={PRIORITY_COLORS[task.priority] || '#6b7280'}
                                  />
                                  <span style={{
                                    fontSize: 10, fontWeight: 500,
                                    color: '#6b7280', textTransform: 'capitalize',
                                  }}>
                                    {task.priority}
                                  </span>
                                </div>
                              )}
                              {task.dueDate && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                  <Calendar
                                    size={10}
                                    color={isOverdue(task.dueDate) ? '#ef4444' : '#3b82f6'}
                                  />
                                  <span style={{
                                    fontSize: 10, fontWeight: 500,
                                    color: isOverdue(task.dueDate) ? '#ef4444' : '#6b7280',
                                  }}>
                                    {new Date(task.dueDate + 'T00:00:00').toLocaleDateString(undefined, {
                                      month: 'short', day: 'numeric',
                                    })}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}

                  {col.tasks.length === 0 && (
                    <div style={{ padding: 12, textAlign: 'center', color: '#9ca3af', fontSize: 11 }}>
                      No tasks
                    </div>
                  )}
                </div>

                {/* Add task button */}
                <button
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    setNewTaskColumnId(col.id)
                  }}
                  style={{
                    padding: '6px 10px', border: 'none',
                    background: 'none', cursor: 'pointer',
                    fontSize: 11, color: '#9ca3af', fontWeight: 500,
                    textAlign: 'left',
                    borderTop: '1px solid rgba(0,0,0,0.05)',
                    flexShrink: 0,
                  }}
                >
                  + Add task
                </button>
              </div>
            ))}

            {/* Add column inline */}
            {showAddColumn ? (
              <div style={{
                width: colWidth, minWidth: colWidth, flexShrink: 0,
                backgroundColor: 'rgba(255,255,255,0.8)',
                borderRadius: 12, padding: 10, display: 'flex', flexDirection: 'column', gap: 6,
                border: '1px solid rgba(0,0,0,0.08)',
              }}>
                <input
                  autoFocus
                  value={newColumnTitle}
                  onChange={(e) => setNewColumnTitle(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation()
                    if (e.key === 'Enter' && newColumnTitle.trim()) handleAddColumn()
                    if (e.key === 'Escape') { setShowAddColumn(false); setNewColumnTitle('') }
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  placeholder="Column title..."
                  style={{
                    width: '100%', border: '1px solid #d1d5db', borderRadius: 6,
                    padding: '6px 8px', fontSize: 12, outline: 'none',
                    background: 'white', color: '#1f2937',
                  }}
                />
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    onPointerDown={(e) => { e.stopPropagation(); handleAddColumn() }}
                    style={{
                      flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 600,
                      borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: '#3b82f6', color: 'white',
                    }}
                  >
                    Add
                  </button>
                  <button
                    onPointerDown={(e) => { e.stopPropagation(); setShowAddColumn(false); setNewColumnTitle('') }}
                    style={{
                      flex: 1, padding: '5px 0', fontSize: 11, fontWeight: 500,
                      borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: '#f4f4f5', color: '#6b7280',
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onPointerDown={(e) => { e.stopPropagation(); setShowAddColumn(true) }}
                style={{
                  width: colWidth, minWidth: colWidth, flexShrink: 0,
                  padding: 12, borderRadius: 12,
                  border: '2px dashed rgba(0,0,0,0.12)',
                  background: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  color: '#9ca3af', fontSize: 12, fontWeight: 500,
                  height: 'fit-content', alignSelf: 'flex-start',
                }}
              >
                <Plus size={14} /> Add Column
              </button>
            )}

            {columns.length === 0 && !showAddColumn && (
              <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13, width: '100%' }}>
                No columns yet. Click + to add one.
              </div>
            )}
          </div>
        </div>

        {/* Color Picker */}
        {showColorPicker && (
          <ColorPicker
            currentColor={color}
            onSelect={handleColorChange}
            onClose={() => setShowColorPicker(false)}
          />
        )}
      </div>

      {/* Delete Board Confirmation */}
      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        itemName={title}
        itemType="kanban board"
      />

      {/* Delete Column Confirmation */}
      <DeleteConfirmModal
        isOpen={!!columnToDelete}
        onConfirm={() => {
          if (columnToDelete) {
            deleteColumn(kanbanId, columnToDelete)
            setColumnToDelete(null)
          }
        }}
        onCancel={() => setColumnToDelete(null)}
        itemName={columns.find((c) => c.id === columnToDelete)?.title}
        itemType="column"
      />

      {/* Delete Task Confirmation */}
      <DeleteConfirmModal
        isOpen={!!taskToDelete}
        onConfirm={() => {
          if (taskToDelete) {
            deleteTask(kanbanId, taskToDelete.columnId, taskToDelete.taskId)
            setTaskToDelete(null)
          }
        }}
        onCancel={() => setTaskToDelete(null)}
        itemName={taskToDelete?.title}
        itemType="task"
      />

      {/* Add Task Modal */}
      <AddTaskModal
        isOpen={!!newTaskColumnId}
        columnTitle={columns.find((c) => c.id === newTaskColumnId)?.title || ''}
        onAdd={(task, assignAfter) => {
          if (newTaskColumnId) handleAddTask(newTaskColumnId, task, assignAfter)
        }}
        onClose={() => setNewTaskColumnId(null)}
      />
    </HTMLContainer>
  )
}
