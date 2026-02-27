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
import { useState, useCallback, useRef } from 'react'
import { Trash2, Palette, GripVertical, Check, Plus, X, Pencil, ChevronUp, ChevronDown, Clock } from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal'
import { TaskModal } from '@/components/TaskModal'
import { ConnectionLinkButton, ConnectionSelectionRing, ConnectionIndicator } from './ConnectionLink'
import { AssignButton } from '@/components/delegation/AssignButton'
import { useChecklistStore, type ChecklistItem as ChecklistItemType } from '@/store/checklistStore'
import { resolveColor, truncateText } from './bordsShapeTypes'
import type { BordsChecklist } from './bordsShapeTypes'
import { format, formatDistanceToNow } from 'date-fns'

/* ── Shape Util ── */
export class BordsChecklistUtil extends ShapeUtil<BordsChecklist> {
  static override type = 'bords-checklist' as const

  static override props: RecordProps<BordsChecklist> = {
    w: T.number,
    h: T.number,
    title: T.string,
    color: T.string,
    checklistId: T.string,
  }

  getDefaultProps(): BordsChecklist['props'] {
    return {
      w: 320,
      h: 400,
      title: 'Checklist',
      color: 'bg-white/90',
      checklistId: '',
    }
  }

  getGeometry(shape: BordsChecklist) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  component(shape: BordsChecklist) {
    return <ChecklistComponent shape={shape} />
  }

  indicator(shape: BordsChecklist) {
    return (
      <rect rx={16} ry={16} width={shape.props.w} height={shape.props.h} fill="none" />
    )
  }

  override canResize() { return true }

  override onResize(shape: BordsChecklist, info: TLResizeInfo<any>) {
    return resizeBox(shape as any, info)
  }

  override canEdit() { return true }

  /* ── SVG export — pure SVG, no foreignObject ── */
  override toSvg(shape: BordsChecklist, _ctx: SvgExportContext) {
    const { w, h, title, color, checklistId } = shape.props
    const bgColor = resolveColor(color)
    const checklist = useChecklistStore.getState().checklists.find((c) => c.id === checklistId)
    const items = checklist?.items || []
    const completed = items.filter((i) => i.completed).length
    const total = items.length

    const headerH = 44
    const itemH = 28
    const pad = 14
    const fontSize = 13

    const maxItems = Math.floor((h - headerH - 8) / itemH)
    const visibleItems = items.slice(0, maxItems)

    return (
      <g>
        {/* Background */}
        <rect width={w} height={h} rx={16} ry={16} fill={bgColor} />
        {/* Header */}
        <text x={pad} y={28} fontSize={15} fontWeight="bold" fill="#1f2937" fontFamily="system-ui, -apple-system, sans-serif">
          {truncateText(title, w - pad * 2 - 60, 15)}
        </text>
        <text x={w - pad} y={28} fontSize={11} fill="#6b7280" textAnchor="end" fontFamily="system-ui, -apple-system, sans-serif">
          {completed}/{total}
        </text>
        {/* Divider */}
        <line x1={pad} y1={headerH} x2={w - pad} y2={headerH} stroke="#d4d4d8" strokeWidth={1} />
        {/* Items */}
        {visibleItems.map((item, i) => {
          const y = headerH + 8 + i * itemH
          return (
            <g key={item.id}>
              {/* Checkbox */}
              <rect x={pad} y={y + 4} width={14} height={14} rx={3} ry={3}
                fill={item.completed ? '#3b82f6' : 'none'}
                stroke={item.completed ? '#3b82f6' : '#9ca3af'} strokeWidth={1.5} />
              {item.completed && (
                <polyline points={`${pad + 3},${y + 11} ${pad + 6},${y + 15} ${pad + 11},${y + 7}`}
                  stroke="#fff" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              )}
              {/* Text */}
              <text x={pad + 22} y={y + 15} fontSize={fontSize} fill={item.completed ? '#9ca3af' : '#374151'}
                textDecoration={item.completed ? 'line-through' : 'none'}
                fontFamily="system-ui, -apple-system, sans-serif">
                {truncateText(item.text, w - pad * 2 - 30, fontSize)}
              </text>
            </g>
          )
        })}
      </g>
    )
  }
}

/* ── Component ── */
function ChecklistComponent({ shape }: { shape: BordsChecklist }) {
  const editor = useEditor()
  const { title, color, w, h, checklistId } = shape.props
  const [showControls, setShowControls] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(title)
  const [showAddTaskModal, setShowAddTaskModal] = useState(false)
  const [editingTask, setEditingTask] = useState<ChecklistItemType | null>(null)
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null)
  const colorBtnRef = useState<HTMLButtonElement | null>(null)

  // Read checklist items from Zustand store
  const checklist = useChecklistStore((s) => s.checklists.find((c) => c.id === checklistId))
  const items = checklist?.items || []
  const toggleItem = useChecklistStore((s) => s.toggleItem)
  const updateItem = useChecklistStore((s) => s.updateItem)
  const reorderItem = useChecklistStore((s) => s.reorderItem)
  const updateChecklist = useChecklistStore((s) => s.updateChecklist)

  const completedCount = items.filter((i) => i.completed).length
  const totalCount = items.length

  const bgColor = resolveColor(color)

  const handleTitleSave = useCallback(() => {
    setIsEditingTitle(false)
    if (editTitle !== title) {
      editor.updateShape({
        id: shape.id,
        type: 'bords-checklist',
        props: { title: editTitle },
      })
      // Also update the Zustand store
      useChecklistStore.getState().updateChecklist(checklistId, { title: editTitle })
    }
  }, [editor, shape.id, editTitle, title, checklistId])

  const handleColorChange = useCallback((newColor: string) => {
    editor.updateShape({
      id: shape.id,
      type: 'bords-checklist',
      props: { color: newColor },
    })
    useChecklistStore.getState().updateChecklist(checklistId, { color: newColor })
  }, [editor, shape.id, checklistId])

  const handleDelete = useCallback(() => {
    editor.deleteShape(shape.id)
    setShowDeleteConfirm(false)
  }, [editor, shape.id])

  /* ── Add task via TaskModal ── */
  const handleAddTask = ({ text, date, time }: { text: string; date: string; time: string }) => {
    if (!checklistId) return
    const store = useChecklistStore.getState()
    const newItem = {
      id: crypto.randomUUID(),
      text: text.trim(),
      completed: false,
      deadline: date && time ? new Date(`${date}T${time}:00`) : undefined,
      timeSpent: 0,
      isTracking: false,
    }
    store.updateChecklist(checklistId, {
      items: [...items, newItem],
    })
  }

  /* ── Edit task via TaskModal ── */
  const handleEditTask = (taskId: string, { text, date, time }: { text: string; date: string; time: string }) => {
    updateItem(checklistId, taskId, {
      text,
      deadline: date && time ? new Date(`${date}T${time}:00`) : undefined,
    })
  }

  /* ── Delete an item ── */
  const handleDeleteItem = (itemId: string) => {
    updateChecklist(checklistId, {
      items: items.filter((i) => i.id !== itemId),
    })
  }

  /* ── Date helpers ── */
  function formatDateForInput(deadline: Date): string {
    if (!deadline || !(deadline instanceof Date) || isNaN(deadline.getTime())) return ''
    return deadline.toISOString().split('T')[0]
  }
  function formatTimeForInput(deadline: Date): string {
    if (!deadline || !(deadline instanceof Date) || isNaN(deadline.getTime())) return ''
    return deadline.toTimeString().slice(0, 5)
  }

  const getTimeStatus = (item: ChecklistItemType) => {
    if (!item.deadline) return null
    const now = new Date().getTime()
    const deadline = new Date(item.deadline).getTime()
    const timeLeft = deadline - now

    if (timeLeft < 0) return {
      text: `Overdue by ${formatDistanceToNow(deadline)}`,
      color: '#ef4444', isUrgent: false,
    }

    const minutes = Math.floor(timeLeft / (1000 * 60))
    const hours = Math.floor(minutes / 60)

    if (minutes <= 30) return {
      text: `⚠️ ${minutes}m left!`, color: '#ef4444', isUrgent: true,
    }
    if (hours < 24) return {
      text: `${hours}h ${minutes % 60}m left`,
      color: hours < 2 ? '#ef4444' : '#f97316', isUrgent: false,
    }
    const days = Math.floor(hours / 24)
    return { text: `${days}d left`, color: '#22c55e', isUrgent: false }
  }

  const formatDateForDisplay = (date: Date | undefined) => {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return null
    try { return format(date, 'MMM d @ h:mm a') } catch { return null }
  }

  return (
    <HTMLContainer
      id={shape.id}
      style={{ width: w, height: h, pointerEvents: 'all' }}
    >
      <div
        data-node-id={checklistId}
        data-item-id={checklistId}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
        style={{ width: '100%', height: '100%', position: 'relative' }}
      >
        <ConnectionSelectionRing itemId={checklistId} />
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
          Checklist
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
              title="Add item"
              onPointerDown={(e) => { e.stopPropagation(); setShowAddTaskModal(true) }}
            >
              <Plus size={14} color="#059669" />
            </button>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <button
              ref={(el) => { (colorBtnRef as any)[0] = el }}
              style={{ padding: 10, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Change color"
              onPointerDown={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker) }}
            >
              <Palette size={14} color="#9333ea" />
            </button>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <ConnectionLinkButton itemId={checklistId} itemType="checklist" />
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <button
              style={{ padding: 10, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Delete checklist"
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
              padding: '14px 16px', display: 'flex', alignItems: 'center',
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
            {/* Progress badge */}
            <div
              style={{
                padding: '2px 8px', borderRadius: 9999,
                fontSize: 11, fontWeight: 600,
                backgroundColor: completedCount === totalCount && totalCount > 0
                  ? '#d1fae5' : '#fef3c7',
                color: completedCount === totalCount && totalCount > 0
                  ? '#065f46' : '#92400e',
              }}
            >
              {completedCount}/{totalCount}
            </div>
          </div>

          {/* Items list */}
          <div
            style={{
              flex: 1, overflow: 'auto', padding: '8px 12px',
              display: 'flex', flexDirection: 'column', gap: 6,
            }}
          >
            {items.map((item, index) => {
              const timeStatus = getTimeStatus(item)
              const dateDisplay = formatDateForDisplay(item.deadline)
              return (
                <div
                  key={item.id}
                  onMouseEnter={() => setHoveredItemId(item.id)}
                  onMouseLeave={() => setHoveredItemId(null)}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 4,
                    padding: '8px 10px', borderRadius: 12,
                    backgroundColor: 'rgba(255,255,255,0.6)',
                    backdropFilter: 'blur(4px)',
                    border: '1px solid rgba(0,0,0,0.05)',
                    position: 'relative',
                  }}
                >
                  {/* Main row */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <button
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        toggleItem(checklistId, item.id)
                      }}
                      style={{
                        width: 20, height: 20, borderRadius: 6, flexShrink: 0,
                        border: item.completed ? 'none' : '2px solid #d1d5db',
                        background: item.completed ? '#10b981' : 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', marginTop: 2,
                      }}
                    >
                      {item.completed && <Check size={12} color="white" strokeWidth={3} />}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 13, lineHeight: 1.4,
                          color: item.completed ? '#9ca3af' : '#1f2937',
                          textDecoration: item.completed ? 'line-through' : 'none',
                          fontWeight: 500, display: 'block',
                        }}
                      >
                        {item.text}
                      </span>

                      {/* Deadline + time status row */}
                      {(dateDisplay || timeStatus) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                          {dateDisplay && (
                            <span style={{
                              fontSize: 10, color: '#6b7280',
                              display: 'flex', alignItems: 'center', gap: 3,
                              backgroundColor: 'rgba(59,130,246,0.08)',
                              padding: '1px 6px', borderRadius: 4,
                            }}>
                              <Clock size={9} color="#60a5fa" />
                              {dateDisplay}
                            </span>
                          )}
                          {!item.completed && timeStatus && (
                            <span style={{
                              fontSize: 10, fontWeight: 600,
                              color: timeStatus.color,
                              animation: timeStatus.isUrgent ? 'pulse 2s infinite' : undefined,
                            }}>
                              {timeStatus.text}
                            </span>
                          )}
                          {item.completed && (
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#16a34a' }}>✓ Done</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Hover action pill */}
                  {hoveredItemId === item.id && (
                    <div
                      style={{
                        position: 'absolute', bottom: 4, right: 4,
                        display: 'flex', alignItems: 'center', gap: 1,
                        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)',
                        borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                        border: '1px solid rgba(0,0,0,0.08)',
                        padding: '2px 4px',
                        zIndex: 5,
                      }}
                    >
                      <button
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          if (index > 0) reorderItem(checklistId, index, index - 1)
                        }}
                        disabled={index === 0}
                        style={{
                          padding: 3, border: 'none', background: 'none', cursor: index > 0 ? 'pointer' : 'default',
                          opacity: index > 0 ? 1 : 0.3, borderRadius: 4,
                        }}
                        title="Move up"
                      >
                        <ChevronUp size={11} color="#6b7280" />
                      </button>
                      <button
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          if (index < items.length - 1) reorderItem(checklistId, index, index + 1)
                        }}
                        disabled={index === items.length - 1}
                        style={{
                          padding: 3, border: 'none', background: 'none',
                          cursor: index < items.length - 1 ? 'pointer' : 'default',
                          opacity: index < items.length - 1 ? 1 : 0.3, borderRadius: 4,
                        }}
                        title="Move down"
                      >
                        <ChevronDown size={11} color="#6b7280" />
                      </button>
                      <div onPointerDown={(e) => e.stopPropagation()}>
                        <AssignButton
                          sourceType="checklist_item"
                          sourceId={item.id}
                          content={item.text}
                          size={11}
                          className="p-1 rounded"
                        />
                      </div>
                      <button
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          setEditingTask(item)
                        }}
                        style={{
                          padding: 3, border: 'none', background: 'none', cursor: 'pointer',
                          borderRadius: 4,
                        }}
                        title="Edit"
                      >
                        <Pencil size={11} color="#3b82f6" />
                      </button>
                      <button
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          handleDeleteItem(item.id)
                        }}
                        style={{
                          padding: 3, border: 'none', background: 'none', cursor: 'pointer',
                          borderRadius: 4,
                        }}
                        title="Delete"
                      >
                        <Trash2 size={11} color="#ef4444" />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}

            {items.length === 0 && (
              <div style={{ padding: 16, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                No items yet. Click + to add one.
              </div>
            )}
          </div>

          {/* Add item button at bottom */}
          <div style={{ padding: '6px 12px', borderTop: '1px solid rgba(0,0,0,0.06)', flexShrink: 0 }}>
            <button
              onPointerDown={(e) => { e.stopPropagation(); setShowAddTaskModal(true) }}
              style={{
                width: '100%', padding: '6px 0', border: 'none',
                background: 'none', cursor: 'pointer',
                fontSize: 12, color: '#6b7280', fontWeight: 600,
                borderRadius: 8,
              }}
            >
              + Add item
            </button>
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

      {/* Delete Confirmation */}
      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        itemName={title}
        itemType="checklist"
      />

      {/* Add Task Modal */}
      {showAddTaskModal && (
        <TaskModal
          title="Add New Task"
          onClose={() => setShowAddTaskModal(false)}
          onSubmit={handleAddTask}
        />
      )}

      {/* Edit Task Modal */}
      {editingTask && (
        <TaskModal
          title="Edit Task"
          initialData={{
            text: editingTask.text,
            date: editingTask.deadline ? formatDateForInput(editingTask.deadline) : '',
            time: editingTask.deadline ? formatTimeForInput(editingTask.deadline) : '',
          }}
          onClose={() => setEditingTask(null)}
          onSubmit={(data) => { handleEditTask(editingTask.id, data); setEditingTask(null) }}
        />
      )}
    </HTMLContainer>
  )
}
