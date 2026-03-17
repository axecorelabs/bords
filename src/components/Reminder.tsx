'use client'
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Resizable } from 're-resizable'
import { Bell, Trash2, Plus, Check, Palette, Clock, Calendar, User, Pencil, X, Send, Loader2, GripVertical } from 'lucide-react'
import { useReminderStore, Reminder as ReminderType } from '../store/reminderStore'
import { useDragModeStore } from '../store/dragModeStore'
import { useConnectionStore } from '../store/connectionStore'
import { ConnectionNode } from './ConnectionNode'
import { useZIndexStore } from '../store/zIndexStore'
import { useGridStore } from '../store/gridStore'
import { DeleteConfirmModal } from './DeleteConfirmModal'
import { ColorPicker } from './ColorPicker'
import { useViewportScale } from '../hooks/useViewportScale'
import { format, formatDistanceToNow, isPast } from 'date-fns'
import toast from 'react-hot-toast'
import { useSession } from '@/components/AuthProvider'
import { sendReminderWithToast, buildReminderWidgetPayload, watchDeadlines } from '../lib/reminders'
import { useIsViewOnly } from '@/lib/useIsViewOnly'

interface ReminderProps extends ReminderType {}

export function Reminder({
  id,
  title,
  items,
  position,
  color,
  width = 280,
  height = 320,
  assignedTo,
}: ReminderProps) {
  const { updateReminder, deleteReminder, toggleItem, addItem, removeItem, updateItem } = useReminderStore()
  const isDragEnabled = useDragModeStore((s) => s.isDragEnabled)
  const { selectedItems, selectItem, deselectItem, isVisible, removeConnectionsByItemId } = useConnectionStore()
  const isSelected = selectedItems.some((item) => item.id === id)
  const [showNodes, setShowNodes] = useState(false)
  const [showControls, setShowControls] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState(title)
  const [addingItem, setAddingItem] = useState(false)
  const [newItemText, setNewItemText] = useState('')
  const [newItemDate, setNewItemDate] = useState('')
  const [newItemTime, setNewItemTime] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [lastSentAt, setLastSentAt] = useState<string | null>(null)
  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const { data: session } = useSession()
  const itemsContainerRef = useRef<HTMLDivElement>(null)
  const connections = useConnectionStore((s) => s.connections)
  const isConnected = connections.some((c) => c.fromId === id || c.toId === id)
  const { bringToFront } = useZIndexStore()
  const zIndex = useZIndexStore((s) => s.zIndexMap[id] || 1)
  const vScale = useViewportScale()
  const isViewOnly = useIsViewOnly()

  const getConnectionSide = () => {
    const connection = connections.find((c) => c.fromId === id || c.toId === id)
    if (!connection) return null
    const otherId = connection.fromId === id ? connection.toId : connection.fromId
    const otherElement = document.querySelector(`[data-node-id="${otherId}"]`)
    if (!otherElement) return null
    const otherRect = otherElement.getBoundingClientRect()
    const thisRect = document.querySelector(`[data-node-id="${id}"]`)?.getBoundingClientRect()
    if (!thisRect) return null
    return otherRect.left < thisRect.left ? 'left' : 'right'
  }

  const positionRef = useRef(position)
  positionRef.current = position
  const stableData = useMemo(() => ({
    type: 'reminder' as const, id, get position() { return positionRef.current },
  }), [id])

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `reminder-${id}`,
    disabled: !isDragEnabled || isViewOnly,
    data: stableData,
  })

  const handleResizeStop = (_e: any, _dir: any, _ref: any, d: any) => {
    updateReminder(id, {
      width: width + Math.round(d.width / vScale),
      height: height + Math.round(d.height / vScale),
    })
  }

  const handleDoubleClick = () => {
    if (isSelected) deselectItem(id)
    else selectItem(id, 'reminder', position)
  }

  const handleSaveTitle = () => {
    if (editTitleValue.trim()) {
      updateReminder(id, { title: editTitleValue.trim() })
    } else {
      setEditTitleValue(title)
    }
    setIsEditingTitle(false)
  }

  const handleAddItem = () => {
    if (!newItemText.trim()) return
    if ((newItemDate && !newItemTime) || (!newItemDate && newItemTime)) {
      toast.error('Set both date and time, or neither')
      return
    }
    addItem(id, {
      id: Date.now().toString(),
      text: newItemText.trim(),
      dueDate: newItemDate || undefined,
      dueTime: newItemTime || undefined,
      completed: false,
    })
    setNewItemText('')
    setNewItemDate('')
    setNewItemTime('')
    setAddingItem(false)
  }

  // Auto-watch deadlines for items that have due dates
  useEffect(() => {
    const watchItems = items
      .filter((item) => item.dueDate && item.dueTime && !item.completed)
      .map((item) => ({
        itemId: item.id,
        text: item.text,
        deadline: new Date(`${item.dueDate}T${item.dueTime}`),
        completed: item.completed,
      }))

    if (watchItems.length === 0) return

    return watchDeadlines({
      watchId: `reminder-${id}`,
      source: 'reminder',
      title,
      items: watchItems,
      recipient: assignedTo
        ? { email: assignedTo.email, name: `${assignedTo.firstName} ${assignedTo.lastName}` }
        : undefined,
    })
  }, [items, title, id, assignedTo])

  // Send reminder via email (manual send button)
  const handleSendReminder = async () => {
    if (sendingEmail) return
    if (items.length === 0) {
      toast.error('Add at least one item before sending')
      return
    }

    setSendingEmail(true)
    try {
      const recipient = assignedTo
        ? { email: assignedTo.email, name: `${assignedTo.firstName} ${assignedTo.lastName}` }
        : undefined

      const payload = buildReminderWidgetPayload(title, items, recipient)
      const result = await sendReminderWithToast(payload)

      if (result.success && !result.deduplicated) {
        setLastSentAt(new Date().toISOString())
      }
    } finally {
      setSendingEmail(false)
    }
  }

  // Calculate completion stats
  const completedCount = items.filter((i) => i.completed).length
  const totalCount = items.length
  const allDone = totalCount > 0 && completedCount === totalCount

  // Check for overdue items
  const hasOverdue = items.some((i) => {
    if (i.completed || !i.dueDate || !i.dueTime) return false
    return isPast(new Date(`${i.dueDate}T${i.dueTime}`))
  })

  const getItemTimeLabel = (dueDate?: string, dueTime?: string) => {
    if (!dueDate || !dueTime) return null
    const dt = new Date(`${dueDate}T${dueTime}`)
    const overdue = isPast(dt)
    return {
      label: overdue
        ? `Overdue (${formatDistanceToNow(dt)} ago)`
        : formatDistanceToNow(dt, { addSuffix: true }),
      overdue,
      formatted: format(dt, 'MMM d, h:mm a'),
    }
  }

  const zoom = useGridStore((s) => s.zoom)
  const zoomedTransform = transform ? { ...transform, x: transform.x / (zoom * vScale), y: transform.y / (zoom * vScale) } : null

  const style = {
    transform: CSS.Translate.toString(zoomedTransform),
    position: 'absolute' as const,
    left: position.x * vScale,
    top: position.y * vScale,
    touchAction: 'none' as const,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10000 : zIndex,
    willChange: isDragging ? 'transform' as const : 'auto' as const,
  }

  return (
    <>
      <div style={style} data-node-id={id} data-item-id={id} onMouseDown={() => { if (!isDragging) bringToFront(id) }}>
        <Resizable
          size={{ width: width * vScale, height: height * vScale }}
          onResizeStop={handleResizeStop}
          minWidth={220 * vScale}
          minHeight={180 * vScale}
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
            bottomRight: { right: '-4px', bottom: '-4px', width: '12px', height: '12px', cursor: 'nwse-resize' },
          }}
        >
          <div
            ref={setNodeRef}
            {...listeners}
            {...attributes}
            onDoubleClick={handleDoubleClick}
            onClick={() => setShowNodes(true)}
            onBlur={() => setShowNodes(false)}
            className={`
              w-full h-full rounded-2xl ${color} cursor-pointer select-none relative
              backdrop-blur-sm border item-container flex flex-col
              ${isSelected ? 'border-amber-400/50 ring-2 ring-amber-400/30' : 'border-black/10'}
              ${isConnected ? 'ring-1 ring-amber-400/50' : ''}
              will-change-transform
            `}
            tabIndex={0}
            onFocus={(e) => e.preventDefault()}
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => setShowControls(false)}
          >
            {/* Connection Indicator for line drawing */}
            {isConnected && isVisible && (
              <div
                className={`
                  absolute top-1/2 -translate-y-1/2 w-3 h-3
                  bg-amber-500 rounded-full border-2 border-white
                  shadow-md animate-pulse connection-indicator
                  ${getConnectionSide() === 'left' ? '-left-1.5' : '-right-1.5'}
                `}
                data-connection-id={`${id}-indicator`}
                data-connection-side={getConnectionSide()}
              />
            )}

            {/* Connection Nodes */}
            {showNodes && isVisible && (
              <>
                <ConnectionNode id={id} type="reminder" position={position} side="left" isVisible={showNodes} />
                <ConnectionNode id={id} type="reminder" position={position} side="right" isVisible={showNodes} />
              </>
            )}

            {/* Header */}
            <div className="flex items-center gap-2 px-4 pt-3 pb-2">
              <GripVertical
                size={16}
                className="text-gray-400 shrink-0"
              />
              <Bell
                size={16}
                className={`shrink-0 ${hasOverdue ? 'text-red-500 animate-pulse' : allDone ? 'text-emerald-500' : 'text-amber-600'}`}
              />
              {isEditingTitle ? (
                <input
                  type="text"
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onBlur={handleSaveTitle}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle()
                    if (e.key === 'Escape') {
                      setEditTitleValue(title)
                      setIsEditingTitle(false)
                    }
                  }}
                  className="flex-1 bg-white/60 px-2 py-0.5 rounded-lg text-sm font-semibold text-gray-800 focus:outline-none focus:ring-1 focus:ring-amber-400/50"
                  autoFocus
                />
              ) : (
                <h3
                  className="flex-1 text-sm font-semibold text-gray-800 truncate cursor-text"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsEditingTitle(true)
                  }}
                >
                  {title}
                </h3>
              )}

              {/* Progress */}
              {totalCount > 0 && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    allDone
                      ? 'bg-emerald-200/80 text-emerald-700'
                      : 'bg-amber-200/80 text-amber-700'
                  }`}
                >
                  {completedCount}/{totalCount}
                </span>
              )}
            </div>

            {/* Assigned To Badge */}
            {assignedTo && (
              <div className="mx-4 mb-1 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-200/50 text-amber-800">
                <User size={11} />
                <span className="text-[10px] font-medium truncate">
                  For {assignedTo.firstName} {assignedTo.lastName}
                </span>
              </div>
            )}

            {/* Items List */}
            <div ref={itemsContainerRef} className="flex-1 overflow-y-auto px-3 pb-1 min-h-0">
              {items.map((item, index) => {
                const timeInfo = getItemTimeLabel(item.dueDate, item.dueTime)
                return (
                  <div
                    key={item.id}
                    className={`group flex items-start gap-2 px-2 py-1.5 rounded-xl transition-colors hover:bg-white/40 ${
                      item.completed ? 'opacity-60' : ''
                    }`}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleItem(id, item.id)
                      }}
                      className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                        item.completed
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-amber-400/60 hover:border-amber-500 bg-white/60'
                      }`}
                    >
                      {item.completed && <Check size={12} strokeWidth={3} />}
                    </button>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-xs font-medium text-gray-800 leading-tight ${
                          item.completed ? 'line-through text-gray-500' : ''
                        }`}
                      >
                        {item.text}
                      </p>
                      {timeInfo && (
                        <p
                          className={`text-[10px] mt-0.5 flex items-center gap-1 ${
                            timeInfo.overdue && !item.completed
                              ? 'text-red-500 font-semibold'
                              : 'text-gray-500'
                          }`}
                          title={timeInfo.formatted}
                        >
                          <Clock size={9} />
                          {timeInfo.label}
                        </p>
                      )}
                    </div>

                    {/* Delete item */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        if (items.length > 1) {
                          removeItem(id, item.id)
                        } else {
                          toast.error('A reminder needs at least one item')
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50/70 rounded-md transition-all mt-0.5 reminder-item-delete"
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                )
              })}

              {/* Inline Add Item */}
              {addingItem && (
                <div
                  className="bg-white/60 rounded-xl p-2 mt-1 space-y-1.5"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    value={newItemText}
                    onChange={(e) => setNewItemText(e.target.value)}
                    placeholder="Reminder text..."
                    className="w-full px-2 py-1.5 text-xs rounded-lg bg-white/80 border-0 focus:ring-1 focus:ring-amber-400/50 focus:outline-none text-gray-800 placeholder:text-gray-400"
                    autoFocus
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') handleAddItem()
                      if (e.key === 'Escape') setAddingItem(false)
                    }}
                  />
                  <div className="flex items-center gap-1.5">
                    <Calendar size={11} className="text-gray-400" />
                    <input
                      type="date"
                      value={newItemDate}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={(e) => setNewItemDate(e.target.value)}
                      className="px-1.5 py-0.5 text-[10px] rounded-md bg-white/80 border-0 focus:ring-1 focus:ring-amber-400/50 focus:outline-none text-gray-700"
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    <Clock size={11} className="text-gray-400" />
                    <input
                      type="time"
                      value={newItemTime}
                      onChange={(e) => setNewItemTime(e.target.value)}
                      className="px-1.5 py-0.5 text-[10px] rounded-md bg-white/80 border-0 focus:ring-1 focus:ring-amber-400/50 focus:outline-none text-gray-700"
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={handleAddItem}
                      className="flex-1 py-1 text-[10px] font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => setAddingItem(false)}
                      className="flex-1 py-1 text-[10px] font-medium bg-white/60 text-gray-600 rounded-lg hover:bg-white/80 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Controls */}
            <div
              className={`flex items-center gap-1.5 px-3 py-2 border-t border-black/5 transition-opacity reminder-bottom-controls ${
                showControls ? 'opacity-100' : 'opacity-0'
              }`}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setAddingItem(true)
                }}
                className="p-1.5 rounded-lg text-gray-500 hover:text-amber-600 hover:bg-amber-50/80 transition-all"
                title="Add item"
              >
                <Plus size={14} />
              </button>
              <button
                ref={colorBtnRef}
                onClick={(e) => {
                  e.stopPropagation()
                  setShowColorPicker(!showColorPicker)
                }}
                className="p-1.5 rounded-lg text-gray-500 hover:text-amber-600 hover:bg-amber-50/80 transition-all"
                title="Change color"
              >
                <Palette size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleSendReminder()
                }}
                disabled={sendingEmail}
                className={`p-1.5 rounded-lg transition-all ${
                  sendingEmail
                    ? 'text-amber-500 animate-pulse'
                    : lastSentAt
                    ? 'text-emerald-500 hover:text-amber-600 hover:bg-amber-50/80'
                    : 'text-gray-500 hover:text-amber-600 hover:bg-amber-50/80'
                }`}
                title={assignedTo ? `Send reminder to ${assignedTo.firstName}` : 'Send reminder to yourself'}
              >
                {sendingEmail ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
              <div className="flex-1" />
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowDeleteConfirm(true)
                }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50/80 transition-all"
                title="Delete reminder"
              >
                <Trash2 size={14} />
              </button>
            </div>

            {/* Color Picker */}
            {showColorPicker && (
              <ColorPicker
                currentColor={color}
                onSelect={(c) => {
                  updateReminder(id, { color: c })
                  setShowColorPicker(false)
                }}
                onClose={() => setShowColorPicker(false)}
                triggerRef={colorBtnRef}
              />
            )}
          </div>
        </Resizable>
      </div>

      {/* Delete Confirm Modal */}
      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onConfirm={() => {
          removeConnectionsByItemId(id)
          deleteReminder(id)
          useZIndexStore.getState().removeItem(id)
          setShowDeleteConfirm(false)
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        itemName={title}
        itemType="reminder"
      />
    </>
  )
}
