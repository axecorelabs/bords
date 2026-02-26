'use client'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Resizable } from 're-resizable'
import { Plus, X, GripVertical, Trash2, Palette, Calendar } from 'lucide-react'
import { useKanbanStore } from '../store/kanbanStore'
import { useDragModeStore } from '../store/dragModeStore'
import { useConnectionStore } from '../store/connectionStore'
import { useBoardStore } from '../store/boardStore'
import { ConnectionNode } from './ConnectionNode'
import type { KanbanBoard as KanbanBoardType, KanbanTask } from '../types/kanban'
import { useZIndexStore } from '../store/zIndexStore'
import { useGridStore } from '../store/gridStore'
import { DeleteConfirmModal } from './DeleteConfirmModal'
import { ColorPicker } from './ColorPicker'
import { AssignButton } from './delegation/AssignButton'
import { useDelegationStore } from '../store/delegationStore'
import { useViewportScale } from '../hooks/useViewportScale'
import { AddTaskModal } from './AddTaskModal'
import { watchDeadlines } from '../lib/reminders'
import { useBoardSyncStore } from '../store/boardSyncStore'

interface KanbanBoardProps {
  board: KanbanBoardType
}

const priorityColors = {
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

export function KanbanBoard({ board }: KanbanBoardProps) {
  const isDragEnabled = useDragModeStore((s) => s.isDragEnabled)
  const currentBoardId = useBoardStore((s) => s.currentBoardId)
  const boardPermission = useBoardSyncStore((s) => s.boardPermissions[currentBoardId || ''] || 'owner')
  const isViewOnly = boardPermission === 'view'
  const {
    updateBoardColor,
    updateBoardTitle,
    updateBoardSize,
    removeBoard,
    addTask,
    moveTask,
    updateTask,
    deleteTask,
    addColumn,
    updateColumn,
    deleteColumn,
  } = useKanbanStore()

  const width = board.width || 800
  const height = board.height || 350
  const vScale = useViewportScale()

  const handleResizeStop = (_e: any, _dir: any, _ref: any, d: any) => {
    updateBoardSize(board.id, width + Math.round(d.width / vScale), height + Math.round(d.height / vScale))
  }

  const { selectItem, deselectItem, selectedItems, removeConnectionsByItemId } =
    useConnectionStore()

  // ── local state ──────────────────────────────────────────────
  const [draggedTask, setDraggedTask] = useState<{
    task: KanbanTask
    columnId: string
  } | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    columnId: string
    index: number
  } | null>(null)

  // Pointer-based task drag refs (touch + mouse + stylus compatible)
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
  const [showAddColumn, setShowAddColumn] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')
  const [newTaskColumnId, setNewTaskColumnId] = useState<string | null>(null)
  const [showNodes, setShowNodes] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(board.title)
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editColumnTitle, setEditColumnTitle] = useState('')
  const [editingTaskData, setEditingTaskData] = useState<{
    columnId: string
    taskId: string
    title: string
    description: string
    priority: 'low' | 'medium' | 'high'
    dueDate: string
  } | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [columnToDelete, setColumnToDelete] = useState<string | null>(null)
  const [taskToDelete, setTaskToDelete] = useState<{
    columnId: string
    taskId: string
    title: string
  } | null>(null)

  const { bringToFront } = useZIndexStore()
  const zIndex = useZIndexStore((s) => s.zIndexMap[board.id] || 1)

  // ── dnd-kit board draggable ──────────────────────────────────
  const positionRef = useRef(board.position)
  positionRef.current = board.position
  const stableData = useMemo(() => ({
    type: 'kanban' as const, id: board.id, get position() { return positionRef.current },
  }), [board.id])

  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `kanban-${board.id}`,
      disabled: !isDragEnabled,
      data: stableData,
    })

  // ── handlers ─────────────────────────────────────────────────
  const handleAddColumn = () => {
    if (!newColumnTitle.trim()) return
    addColumn(board.id, {
      id: Date.now().toString(),
      title: newColumnTitle,
      tasks: [],
    })
    setNewColumnTitle('')
    setShowAddColumn(false)
  }

  const handleAddTask = (columnId: string, task: KanbanTask, assignAfter: boolean) => {
    addTask(board.id, columnId, task)

    if (assignAfter) {
      const column = board.columns.find((c) => c.id === columnId)
      useDelegationStore.getState().openAssignModal({
        sourceType: 'kanban_task',
        sourceId: task.id,
        content: task.title,
        columnId,
        columnTitle: column?.title || columnId,
        availableColumns: board.columns.map((c) => ({ id: c.id, title: c.title })),
      })
    }

    setNewTaskColumnId(null)
  }

  const handleDrop = (
    targetColumnId: string,
    index: number,
  ) => {
    if (!draggedTask) return
    moveTask(
      board.id,
      draggedTask.task.id,
      draggedTask.columnId,
      targetColumnId,
      index,
    )
    // Sync column move to TaskAssignment if cross-column
    if (draggedTask.columnId !== targetColumnId) {
      const targetCol = board.columns.find((c) => c.id === targetColumnId)
      if (targetCol) {
        useDelegationStore.getState().syncOwnerColumnMove(
          draggedTask.task.id,
          targetColumnId,
          targetCol.title,
        )
      }
    }
    setDraggedTask(null)
  }

  // ── Pointer-based task drag (works on touch/stylus/mouse) ───
  const DRAG_THRESHOLD = 5 // px before drag activates

  const handleTaskPointerDown = useCallback(
    (e: React.PointerEvent, task: KanbanTask, columnId: string) => {
      // Only primary button (left click / stylus tip / touch)
      if (e.button !== 0) return
      // Don't drag if editing or view-only
      if (editingTaskData?.taskId === task.id) return
      if (isViewOnly) return
      e.stopPropagation()
      e.preventDefault()

      const sourceEl = e.currentTarget as HTMLElement
      sourceEl.setPointerCapture(e.pointerId)

      pointerDragRef.current = {
        task,
        columnId,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        ghostEl: null,
        sourceEl,
        isDragging: false,
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

      // Check threshold before activating drag
      if (!drag.isDragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        drag.isDragging = true
        setDraggedTask({ task: drag.task, columnId: drag.columnId })

        // Create ghost element
        const ghost = document.createElement('div')
        ghost.className =
          'fixed pointer-events-none z-[99999] p-3 rounded-xl border bg-white border-blue-300 shadow-2xl opacity-90 text-sm font-medium text-gray-800 max-w-[220px] truncate'
        ghost.textContent = drag.task.title
        ghost.style.left = `${e.clientX - 40}px`
        ghost.style.top = `${e.clientY - 15}px`
        document.body.appendChild(ghost)
        drag.ghostEl = ghost

        // Dim source
        if (drag.sourceEl) drag.sourceEl.style.opacity = '0.3'
      }

      // Move ghost
      if (drag.ghostEl) {
        drag.ghostEl.style.left = `${e.clientX - 40}px`
        drag.ghostEl.style.top = `${e.clientY - 15}px`
      }

      // Hit-test to find drop target column & position
      if (drag.ghostEl) drag.ghostEl.style.display = 'none'
      const elBelow = document.elementFromPoint(e.clientX, e.clientY)
      if (drag.ghostEl) drag.ghostEl.style.display = ''

      if (elBelow) {
        // Find the column drop zone
        const colEl = elBelow.closest('[data-kanban-column]') as HTMLElement
        if (colEl) {
          const colId = colEl.dataset.kanbanColumn!
          // Find task index at this y position
          const taskEls = Array.from(
            colEl.querySelectorAll('[data-kanban-task]'),
          ) as HTMLElement[]
          let idx = taskEls.length
          for (let i = 0; i < taskEls.length; i++) {
            const rect = taskEls[i].getBoundingClientRect()
            if (e.clientY < rect.top + rect.height / 2) {
              idx = i
              break
            }
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

      // Clean up ghost
      if (drag.ghostEl) {
        drag.ghostEl.remove()
        drag.ghostEl = null
      }

      // Restore source opacity
      if (drag.sourceEl) drag.sourceEl.style.opacity = ''

      // Release pointer capture
      try {
        ;(e.currentTarget as HTMLElement).releasePointerCapture(drag.pointerId)
      } catch {}

      if (drag.isDragging && dropTarget) {
        moveTask(
          board.id,
          drag.task.id,
          drag.columnId,
          dropTarget.columnId,
          dropTarget.index,
        )
        // Sync column move to TaskAssignment if cross-column
        if (drag.columnId !== dropTarget.columnId) {
          const targetCol = board.columns.find((c) => c.id === dropTarget.columnId)
          if (targetCol) {
            useDelegationStore.getState().syncOwnerColumnMove(
              drag.task.id,
              dropTarget.columnId,
              targetCol.title,
            )
          }
        }
      }

      pointerDragRef.current = null
      setDraggedTask(null)
      setDropTarget(null)
    },
    [board.id, board.columns, dropTarget, moveTask],
  )

  const handleTaskPointerCancel = useCallback((e: React.PointerEvent) => {
    const drag = pointerDragRef.current
    if (!drag) return
    if (drag.ghostEl) {
      drag.ghostEl.remove()
      drag.ghostEl = null
    }
    if (drag.sourceEl) drag.sourceEl.style.opacity = ''
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(drag.pointerId)
    } catch {}
    pointerDragRef.current = null
    setDraggedTask(null)
    setDropTarget(null)
  }, [])

  // double-click on the board background toggles connection selection
  const handleDoubleClick = () => {
    const sel = selectedItems.some((i) => i.id === board.id)
    if (sel) deselectItem(board.id)
    else selectItem(board.id, 'kanban', board.position)
  }

  // ── connection helpers ───────────────────────────────────────
  const connections = useConnectionStore((s) => s.connections)
  const isConnected = connections.some(
    (c) => c.fromId === board.id || c.toId === board.id,
  )
  const isVisible = useConnectionStore((s) => s.isVisible)
  const isSelected = selectedItems.some((i) => i.id === board.id)

  const getConnectionSide = () => {
    const conn = connections.find(
      (c) => c.fromId === board.id || c.toId === board.id,
    )
    if (!conn) return null
    const otherId = conn.fromId === board.id ? conn.toId : conn.fromId
    const otherEl = document.querySelector(`[data-node-id="${otherId}"]`)
    const thisEl = document.querySelector(`[data-node-id="${board.id}"]`)
    if (!otherEl || !thisEl) return null
    return otherEl.getBoundingClientRect().left <
      thisEl.getBoundingClientRect().left
      ? 'left'
      : 'right'
  }

  // ── save helpers for edit form ───────────────────────────────
  const saveEditingTask = () => {
    if (!editingTaskData) return
    if (editingTaskData.title.trim()) {
      updateTask(board.id, editingTaskData.columnId, editingTaskData.taskId, {
        title: editingTaskData.title.trim(),
        description: editingTaskData.description.trim() || undefined,
        priority: editingTaskData.priority,
        dueDate: editingTaskData.dueDate || undefined,
      })
    }
    setEditingTaskData(null)
  }

  // ── Watch kanban task deadlines for automatic reminders ──
  useEffect(() => {
    const allTasks = board.columns.flatMap((col) =>
      col.tasks
        .filter((t) => t.dueDate && !t.completed)
        .map((t) => ({
          itemId: t.id,
          text: t.title,
          deadline: new Date(t.dueDate + 'T00:00:00'),
          completed: t.completed ?? false,
        }))
    )

    if (allTasks.length === 0) return

    return watchDeadlines({
      watchId: `kanban-${board.id}`,
      source: 'kanban',
      title: board.title,
      items: allTasks,
    })
  }, [board.columns, board.title, board.id])

  // ── style ────────────────────────────────────────────────────
  const zoom = useGridStore((s) => s.zoom)
  const zoomedTransform = transform ? { ...transform, x: transform.x / (zoom * vScale), y: transform.y / (zoom * vScale) } : null

  const style = {
    transform: CSS.Translate.toString(zoomedTransform),
    position: 'absolute' as const,
    left: board.position.x * vScale,
    top: board.position.y * vScale,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10000 : zIndex,
    willChange: isDragging ? 'transform' as const : 'auto' as const,
  }

  // ────────────────────────────────────────────────────────────
  return (
    <>
      <div
        style={style}
        data-node-id={board.id}
        data-item-id={board.id}
        onMouseDown={() => { if (!isDragging) bringToFront(board.id) }}
      >
        <Resizable
          size={{ width: width * vScale, height: height * vScale }}
          onResizeStop={handleResizeStop}
          minWidth={600 * vScale}
          minHeight={450 * vScale}
          enable={{
            top: false,
            right: !isDragging,
            bottom: !isDragging,
            left: false,
            topRight: false,
            bottomRight: !isDragging,
            bottomLeft: false,
            topLeft: false,
          }}
          handleStyles={{
            right: { right: '-4px', width: '8px', cursor: 'ew-resize' },
            bottom: { bottom: '-4px', height: '8px', cursor: 'ns-resize' },
            bottomRight: {
              right: '-4px',
              bottom: '-4px',
              width: '12px',
              height: '12px',
              cursor: 'nwse-resize',
            },
          }}
        >
          <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            onDoubleClick={handleDoubleClick}
            onMouseEnter={() => setShowNodes(true)}
            onMouseLeave={() => {
              setShowNodes(false)
              setShowColorPicker(false)
            }}
            className={`w-full h-full rounded-3xl backdrop-blur-sm item-container flex flex-col overflow-hidden ${board.color} ${
              isSelected ? 'ring-2 ring-blue-400/30' : ''
            } ${isConnected ? 'ring-1 ring-blue-400/50' : ''}`}
            style={{
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 10px 40px rgba(0, 0, 0, 0.15)',
              touchAction: 'none',
              cursor: isDragEnabled ? 'move' : 'default',
            }}
          >
            {/* Connection indicator dot */}
            {isConnected && isVisible && (
              <div
                className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500 rounded-full border-2 border-white shadow-md animate-pulse connection-indicator ${
                  getConnectionSide() === 'left' ? '-left-1.5' : '-right-1.5'
                }`}
                data-connection-id={`${board.id}-indicator`}
                data-connection-side={getConnectionSide()}
              />
            )}

            {/* ═══════  HEADER  ═══════ */}
            <div
              className={`flex items-center justify-between px-4 py-3 border-b shrink-0 relative border-zinc-200/50`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <GripVertical
                  size={18}
                  className="text-gray-400"
                />
                {isEditingTitle ? (
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="font-semibold text-lg rounded-lg px-2 py-1 border focus:ring-2 focus:ring-blue-400/50 focus:outline-none bg-white/80 border-zinc-300 text-gray-800"
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter' && editTitle.trim()) {
                        updateBoardTitle(board.id, editTitle.trim())
                        setIsEditingTitle(false)
                      }
                      if (e.key === 'Escape') {
                        setEditTitle(board.title)
                        setIsEditingTitle(false)
                      }
                    }}
                    onBlur={() => {
                      if (editTitle.trim())
                        updateBoardTitle(board.id, editTitle.trim())
                      setIsEditingTitle(false)
                    }}
                  />
                ) : (
                  <h3
                    className="font-semibold text-lg cursor-pointer hover:bg-white/30 rounded-lg px-2 py-1 transition-colors truncate text-gray-800"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      if (isViewOnly) return
                      setEditTitle(board.title)
                      setIsEditingTitle(true)
                    }}
                    title={isViewOnly ? board.title : "Double-click to rename"}
                  >
                    {board.title}
                  </h3>
                )}
              </div>

              {!isViewOnly && <div className="flex items-center gap-1 shrink-0">
                <button
                  ref={colorBtnRef}
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowColorPicker(!showColorPicker)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="p-2 rounded-xl transition-all hover:scale-105 group hover:bg-purple-50"
                  title="Change board color"
                >
                  <Palette
                    size={18}
                    className="text-gray-400 group-hover:text-purple-500 transition-colors"
                  />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowDeleteConfirm(true)
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  className="p-2 rounded-xl transition-all hover:scale-105 group hover:bg-red-50"
                  title="Delete board"
                >
                  <Trash2
                    size={18}
                    className="text-gray-400 group-hover:text-red-500 transition-colors"
                  />
                </button>
              </div>}

              {/* Color picker dropdown */}
              {showColorPicker && (
                <ColorPicker
                  currentColor={board.color}
                  onSelect={(c) => updateBoardColor(board.id, c)}
                  onClose={() => setShowColorPicker(false)}
                  label="Board Color"
                  triggerRef={colorBtnRef}
                />
              )}
            </div>

            {/* Connection Nodes */}
            <ConnectionNode
              id={board.id}
              type="kanban"
              side="left"
              position={board.position}
              isVisible={showNodes}
            />
            <ConnectionNode
              id={board.id}
              type="kanban"
              side="right"
              position={board.position}
              isVisible={showNodes}
            />

            {/* ═══════  COLUMNS  ═══════ */}
            <div className="flex-1 flex gap-3 p-4 overflow-x-auto overflow-y-hidden min-h-0">
              {board.columns.map((column) => (
                <div
                  key={column.id}
                  data-kanban-column={column.id}
                  className={`rounded-2xl flex flex-col shrink-0 transition-colors ${
                    dropTarget?.columnId === column.id
                      ? 'bg-blue-50/80 ring-2 ring-blue-300/50'
                      : 'bg-zinc-50/80'
                  }`}
                  style={{ width: `${Math.round(240 * vScale)}px` }}
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between p-3 pb-2 shrink-0">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {editingColumnId === column.id ? (
                        <input
                          type="text"
                          value={editColumnTitle}
                          onChange={(e) => setEditColumnTitle(e.target.value)}
                          className="font-semibold text-sm rounded-lg px-2 py-1 border focus:ring-2 focus:ring-blue-400/50 focus:outline-none w-full bg-white border-zinc-300 text-gray-800"
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation()
                            if (e.key === 'Enter' && editColumnTitle.trim()) {
                              updateColumn(
                                board.id,
                                column.id,
                                editColumnTitle.trim(),
                              )
                              setEditingColumnId(null)
                            }
                            if (e.key === 'Escape') setEditingColumnId(null)
                          }}
                          onBlur={() => {
                            if (editColumnTitle.trim())
                              updateColumn(
                                board.id,
                                column.id,
                                editColumnTitle.trim(),
                              )
                            setEditingColumnId(null)
                          }}
                        />
                      ) : (
                        <h4
                          className="font-semibold text-sm cursor-pointer rounded px-1 py-0.5 transition-colors truncate text-gray-800 hover:bg-white/60"
                          onDoubleClick={(e) => {
                            e.stopPropagation()
                            if (isViewOnly) return
                            setEditColumnTitle(column.title)
                            setEditingColumnId(column.id)
                          }}
                          title={isViewOnly ? column.title : "Double-click to rename"}
                        >
                          {column.title}
                        </h4>
                      )}
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium shadow-sm shrink-0 bg-white/80 text-gray-700"
                      >
                        {column.tasks.length}
                      </span>
                    </div>
                    {!isViewOnly && <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setColumnToDelete(column.id)
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className={`p-1.5 rounded-lg transition-all hover:scale-105 group shrink-0 hover:bg-red-50`}
                    >
                      <Trash2
                        size={14}
                        className="text-gray-400 group-hover:text-red-500 transition-colors"
                      />
                    </button>}
                  </div>

                  {/* Scrollable task list */}
                  <div
                    className="flex-1 overflow-y-auto px-3 space-y-2 min-h-0"
                    style={{
                      scrollbarWidth: 'thin',
                      scrollbarColor: '#d4d4d8 transparent',
                    }}
                  >
                    {column.tasks.length === 0 &&
                      !draggedTask &&
                      newTaskColumnId !== column.id && (
                        <div
                          className={`text-center py-6 text-xs text-gray-400`}
                        >
                          No tasks yet
                        </div>
                      )}

                    {column.tasks.map((task, index) => (
                      <div
                        key={task.id}
                        data-kanban-task={task.id}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          handleTaskPointerDown(e, task, column.id)
                        }}
                        onPointerMove={handleTaskPointerMove}
                        onPointerUp={handleTaskPointerUp}
                        onPointerCancel={handleTaskPointerCancel}
                        style={{ touchAction: 'none' }}
                        className={`p-3 rounded-xl border cursor-grab active:cursor-grabbing group transition-all bg-white border-zinc-200/60 hover:border-zinc-300 hover:shadow-md select-none ${
                          draggedTask?.task.id === task.id
                            ? 'opacity-30 scale-95'
                            : ''
                        } ${
                          dropTarget?.columnId === column.id &&
                          dropTarget?.index === index
                            ? 'border-t-2 border-t-blue-400'
                            : ''
                        }`}
                      >
                        {/* ── Inline edit form ── */}
                        {editingTaskData?.taskId === task.id &&
                        editingTaskData?.columnId === column.id ? (
                          <div
                            className="space-y-2"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <input
                              type="text"
                              value={editingTaskData.title}
                              onChange={(e) =>
                                setEditingTaskData({
                                  ...editingTaskData,
                                  title: e.target.value,
                                })
                              }
                              className="w-full px-2 py-1 text-sm rounded-lg border focus:ring-2 focus:ring-blue-400/50 focus:outline-none bg-white border-zinc-200 text-gray-900"
                              autoFocus
                              onKeyDown={(e) => {
                                e.stopPropagation()
                                if (e.key === 'Enter') saveEditingTask()
                                if (e.key === 'Escape')
                                  setEditingTaskData(null)
                              }}
                            />
                            <textarea
                              value={editingTaskData.description}
                              onChange={(e) =>
                                setEditingTaskData({
                                  ...editingTaskData,
                                  description: e.target.value,
                                })
                              }
                              placeholder="Description (optional)"
                              className="w-full px-2 py-1 text-xs rounded-lg border focus:ring-2 focus:ring-blue-400/50 focus:outline-none resize-none bg-white border-zinc-200 text-gray-900 placeholder:text-gray-400"
                              rows={2}
                              onKeyDown={(e) => e.stopPropagation()}
                            />
                            <div className="flex gap-1">
                              {(['low', 'medium', 'high'] as const).map(
                                (p) => (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setEditingTaskData({
                                        ...editingTaskData,
                                        priority: p,
                                      })
                                    }}
                                    className={`px-2 py-1 text-xs rounded-lg capitalize transition-colors ${
                                      editingTaskData.priority === p
                                        ? `${priorityColors[p]} text-white`
                                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                  >
                                    {p}
                                  </button>
                                ),
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Calendar
                                size={14}
                                className="text-gray-400 shrink-0"
                              />
                              <input
                                type="date"
                                value={editingTaskData.dueDate}
                                onChange={(e) => {
                                  e.stopPropagation()
                                  setEditingTaskData({
                                    ...editingTaskData,
                                    dueDate: e.target.value,
                                  })
                                }}
                                className="flex-1 px-2 py-1 text-xs rounded-lg border focus:ring-2 focus:ring-blue-400/50 focus:outline-none bg-white border-zinc-200 text-gray-900"
                                onKeyDown={(e) => e.stopPropagation()}
                              />
                              {editingTaskData.dueDate && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setEditingTaskData({
                                      ...editingTaskData,
                                      dueDate: '',
                                    })
                                  }}
                                  className={`p-0.5 rounded hover:bg-gray-100`}
                                  title="Clear date"
                                >
                                  <X size={12} className="text-gray-400" />
                                </button>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  saveEditingTask()
                                }}
                                className="flex-1 px-2 py-1 text-xs font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingTaskData(null)
                                }}
                                className="flex-1 px-2 py-1 text-xs font-medium rounded-lg transition-colors bg-gray-100 text-gray-700 hover:bg-gray-200"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          /* ── Task card display ── */
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <h5
                                className={`font-medium text-sm flex-1 cursor-pointer text-gray-800 ${task.completed ? 'line-through opacity-60' : ''}`}
                                onDoubleClick={(e) => {
                                  e.stopPropagation()
                                  if (isViewOnly) return
                                  setEditingTaskData({
                                    columnId: column.id,
                                    taskId: task.id,
                                    title: task.title,
                                    description: task.description || '',
                                    priority: task.priority || 'medium',
                                    dueDate: task.dueDate || '',
                                  })
                                }}
                                title={isViewOnly ? task.title : "Double-click to edit"}
                              >
                                {task.title}
                              </h5>
                              {!isViewOnly && <div
                                className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all"
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <AssignButton
                                  sourceType="kanban_task"
                                  sourceId={task.id}
                                  content={task.title}
                                  size={14}
                                  columnId={column.id}
                                  columnTitle={column.title}
                                  availableColumns={board.columns.map((c) => ({ id: c.id, title: c.title }))}
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setTaskToDelete({
                                      columnId: column.id,
                                      taskId: task.id,
                                      title: task.title,
                                    })
                                  }}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  className={`p-1 rounded-lg transition-all hover:scale-105 hover:bg-red-50`}
                                >
                                  <X
                                    size={14}
                                    className="text-gray-400 hover:text-red-500 transition-colors"
                                  />
                                </button>
                              </div>}
                            </div>
                            {task.description && (
                              <p
                                className="text-xs mt-1.5 line-clamp-2 text-gray-600"
                              >
                                {task.description}
                              </p>
                            )}
                            {(task.priority || task.dueDate) && (
                              <div className="flex items-center gap-3 mt-2 flex-wrap">
                                {task.priority && (
                                  <div className="flex items-center gap-1.5">
                                    <span
                                      className={`w-2 h-2 rounded-full ${priorityColors[task.priority]}`}
                                    />
                                    <span
                                      className="text-xs capitalize font-medium text-gray-600"
                                    >
                                      {task.priority}
                                    </span>
                                  </div>
                                )}
                                {task.dueDate && (
                                  <div className="flex items-center gap-1">
                                    <Calendar
                                      size={11}
                                      className={
                                        isOverdue(task.dueDate)
                                          ? 'text-red-500'
                                          : 'text-blue-500'
                                      }
                                    />
                                    <span
                                      className={`text-xs font-medium ${
                                        isOverdue(task.dueDate)
                                          ? 'text-red-500'
                                          : 'text-gray-500'
                                      }`}
                                    >
                                      {new Date(
                                        task.dueDate + 'T00:00:00',
                                      ).toLocaleDateString(undefined, {
                                        month: 'short',
                                        day: 'numeric',
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

                    {/* Drop zone hint while dragging */}
                    {draggedTask && draggedTask.columnId !== column.id && (
                      <div
                        className="p-3 rounded-xl border-2 border-dashed transition-colors border-zinc-200 bg-zinc-50/50"
                      >
                        <p
                          className="text-xs text-center text-gray-400"
                        >
                          Drop here
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Add task — pinned at column bottom */}
                  {!isViewOnly && <div className="p-3 pt-2 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setNewTaskColumnId(column.id)
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="w-full p-2 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 transition-all border-zinc-200 text-gray-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/50 active:bg-blue-50"
                    >
                      <Plus size={16} />
                      <span className="text-xs font-medium">Add task</span>
                    </button>
                  </div>}
                </div>
              ))}

              {/* ═══════  ADD COLUMN — inline as last item  ═══════ */}
              {!isViewOnly && <div
                className="shrink-0 flex items-start"
                style={{ width: `${Math.round(240 * vScale)}px` }}
              >
                {showAddColumn ? (
                  <div
                    className="w-full rounded-2xl p-3 border bg-white/80 border-zinc-200/50"
                  >
                    <input
                      type="text"
                      placeholder="Column title"
                      value={newColumnTitle}
                      onChange={(e) => setNewColumnTitle(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation()
                        if (e.key === 'Enter') handleAddColumn()
                        if (e.key === 'Escape') {
                          setShowAddColumn(false)
                          setNewColumnTitle('')
                        }
                      }}
                      className="w-full px-3 py-2 mb-2 text-sm rounded-lg border focus:ring-2 focus:ring-blue-400/50 focus:outline-none bg-white border-zinc-200 text-zinc-900 placeholder:text-gray-500"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleAddColumn()
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="flex-1 px-3 py-2 text-sm font-semibold bg-blue-500 text-white rounded-lg hover:bg-blue-600 shadow-md transition-all"
                      >
                        Add
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowAddColumn(false)
                          setNewColumnTitle('')
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-all bg-gray-100 text-gray-700 hover:bg-gray-200"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowAddColumn(true)
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className="w-full p-3 rounded-2xl border-2 border-dashed flex items-center justify-center gap-2 transition-all border-zinc-200 text-gray-400 hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50/50"
                  >
                    <Plus size={18} />
                    <span className="text-sm font-medium">Add Column</span>
                  </button>
                )}
              </div>}
            </div>
          </div>
        </Resizable>
      </div>

      {/* Delete Board */}
      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onConfirm={() => {
          removeConnectionsByItemId(board.id)
          removeBoard(board.id)
          useZIndexStore.getState().removeItem(board.id)
          setShowDeleteConfirm(false)
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        itemName={board.title}
        itemType="kanban board"
      />

      {/* Delete Column */}
      <DeleteConfirmModal
        isOpen={!!columnToDelete}
        onConfirm={() => {
          if (columnToDelete) {
            deleteColumn(board.id, columnToDelete)
            setColumnToDelete(null)
          }
        }}
        onCancel={() => setColumnToDelete(null)}
        itemName={board.columns.find((c) => c.id === columnToDelete)?.title}
        itemType="column"
      />

      {/* Delete Task */}
      <DeleteConfirmModal
        isOpen={!!taskToDelete}
        onConfirm={() => {
          if (taskToDelete) {
            deleteTask(board.id, taskToDelete.columnId, taskToDelete.taskId)
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
        columnTitle={board.columns.find((c) => c.id === newTaskColumnId)?.title || ''}
        onAdd={(task, assignAfter) => {
          if (newTaskColumnId) handleAddTask(newTaskColumnId, task, assignAfter)
        }}
        onClose={() => setNewTaskColumnId(null)}
      />
    </>
  )
}
