'use client'
import { Trash2, Check, Clock, Pencil, Palette, ChevronDown, ChevronUp, MoreVertical, GripVertical } from 'lucide-react'
import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Resizable } from 're-resizable'
import { useChecklistStore, ChecklistItem as ChecklistItemType } from '../store/checklistStore'
import { useDragModeStore } from '../store/dragModeStore'
import { toast } from 'react-hot-toast'
import { format, formatDistanceToNow } from 'date-fns'
import { watchDeadlines } from '../lib/reminders'
import { TaskModal } from './TaskModal'
import { useConnectionStore } from '../store/connectionStore';
import { ConnectionNode } from './ConnectionNode'
import { useGridStore } from '../store/gridStore'
import { useZIndexStore } from '../store/zIndexStore'
import { DeleteConfirmModal } from './DeleteConfirmModal'
import { ColorPicker } from './ColorPicker'
import { AssignButton } from './delegation/AssignButton'
import { useDelegationStore } from '../store/delegationStore'
import { useViewportScale } from '../hooks/useViewportScale'
import { useBoardSyncStore } from '../store/boardSyncStore'
import { useBoardStore } from '../store/boardStore'

/** Small inline indicator showing assignee completion avatars for multi-assigned checklist items */
function AssigneeCompletionDots({ sourceId }: { sourceId: string }) {
  const assignments = useDelegationStore((s) => s.assignments)
  const filtered = assignments.filter(
    (a) => a.sourceType === 'checklist_item' && a.sourceId === sourceId && !a.isDeleted
  )
  if (filtered.length < 2) return null

  const completed = filtered.filter((a) => a.status === 'completed').length
  const total = filtered.length

  return (
    <div className="flex items-center gap-1" title={`${completed}/${total} completed`}>
      <div className="flex -space-x-1.5">
        {filtered.slice(0, 4).map((a) => {
          const initial = a.assignee?.firstName?.charAt(0) || '?'
          const done = a.status === 'completed'
          return (
            <div
              key={a._id}
              className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border-2 border-white ${
                done ? 'bg-emerald-500 text-white' : 'bg-zinc-200 text-zinc-600'
              }`}
              title={`${a.assignee?.firstName || 'Unknown'} ${a.assignee?.lastName || ''} — ${done ? 'Completed' : a.status}`}
            >
              {done ? '✓' : initial}
            </div>
          )
        })}
        {filtered.length > 4 && (
          <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold border-2 border-white bg-zinc-300 text-zinc-600">
            +{filtered.length - 4}
          </div>
        )}
      </div>
      {completed > 0 && completed < total && (
        <span className="text-[10px] font-semibold text-amber-600">{completed}/{total}</span>
      )}
    </div>
  )
}

/** Touch-only three-dot popup for each checklist task */
function TouchTaskMenu({
  index,
  total,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
  assignButton,
}: {
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onEdit: () => void
  onDelete: () => void
  assignButton: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    if (!open) return
    const handleOutside = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handleOutside)
    return () => document.removeEventListener('pointerdown', handleOutside)
  }, [open])

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 4, left: rect.right })
    }
    setOpen(!open)
  }

  return (
    <div className="absolute top-1 right-1 touch-only z-[9999]">
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="p-1 rounded-md bg-white/80 backdrop-blur-sm border border-black/5 shadow-sm active:bg-gray-100"
      >
        <MoreVertical size={14} className="text-gray-500" />
      </button>
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="fixed bg-white rounded-xl shadow-xl border border-black/10 py-1 min-w-[160px] z-[99999]"
          style={{ top: pos.top, left: pos.left, transform: 'translateX(-100%)' }}
          onClick={() => setOpen(false)}
        >
          <button
            onClick={onMoveUp}
            disabled={index === 0}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-30 transition-colors"
          >
            <ChevronUp size={14} /> Move up
          </button>
          <button
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-30 transition-colors"
          >
            <ChevronDown size={14} /> Move down
          </button>
          {assignButton}
          <button
            onClick={onEdit}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <Pencil size={14} /> Edit
          </button>
          <div className="h-px bg-gray-100 my-1" />
          <button
            onClick={onDelete}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}

interface ChecklistProps {
  id: string
  title: string
  items: ChecklistItemType[]
  position: { x: number; y: number }
  color: string
  width?: number
  height?: number
}



export function Checklist({ id, title, items, position, color, width = 320, height = 400 }: ChecklistProps) {
  const { updateChecklist, deleteChecklist, toggleItem, updateItem, reorderItem } = useChecklistStore()
  const isDragEnabled = useDragModeStore((state) => state.isDragEnabled)
  const _currentBoardId = useBoardStore((state) => state.currentBoardId)
  const boardPermission = useBoardSyncStore((s) => s.boardPermissions[_currentBoardId || ''] || 'owner')
  const isViewOnly = boardPermission === 'view'
  const [editingTask, setEditingTask] = useState<ChecklistItemType | null>(null);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const { selectedItems, selectItem, deselectItem, isVisible, removeConnectionsByItemId } = useConnectionStore();
  const isSelected = selectedItems.some(item => item.id === id);
  const [showNodes, setShowNodes] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const [hasOverflow, setHasOverflow] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
   const [editTitleValue, setEditTitleValue] = useState(title)  
   const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)  
   const itemsContainerRef = useRef<HTMLDivElement>(null)
  const zoom = useGridStore((state) => state.zoom)
  const vScale = useViewportScale()
  const connections = useConnectionStore((state) => state.connections)
  const isConnected = connections.some(conn => conn.fromId === id || conn.toId === id)
  const { bringToFront } = useZIndexStore()
  const zIndex = useZIndexStore((state) => state.zIndexMap[id] || 1)

  const handleResizeStop = (e: any, direction: any, ref: any, d: any) => {
    updateChecklist(id, {
      width: width + Math.round(d.width / vScale),
      height: height + Math.round(d.height / vScale)
    })
  }

  const handleDoubleClick = () => {
    if (isSelected) {
      deselectItem(id);
    } else {
      selectItem(id, 'checklist', position);
    }
  };

  // Watch deadlines and send reminders via centralized system
  useEffect(() => {
    return watchDeadlines({
      watchId: `checklist-${id}`,
      source: 'checklist',
      title,
      items: items
        .filter((item) => item.deadline && !item.completed)
        .map((item) => ({
          itemId: item.id,
          text: item.text,
          deadline: new Date(item.deadline!),
          completed: item.completed,
        })),
    })
  }, [items, title, id])

  // Check for overflow
  useEffect(() => {
    const checkOverflow = () => {
      if (itemsContainerRef.current) {
        const { scrollHeight, clientHeight } = itemsContainerRef.current
        setHasOverflow(scrollHeight > clientHeight + 5)
      }
    }

    checkOverflow()
    window.addEventListener('resize', checkOverflow)
    return () => window.removeEventListener('resize', checkOverflow)
  }, [items, height])

  const getTimeStatus = (item: ChecklistItemType) => {
    if (!item.deadline) return null;
    
    const now = new Date().getTime();
    const deadline = new Date(item.deadline).getTime();
    const timeLeft = deadline - now;
    
    if (timeLeft < 0) return { 
      text: `Overdue by ${formatDistanceToNow(deadline)}`, 
      color: 'bg-red-500 text-white px-2 py-0.5 rounded text-[10px] font-medium',
      isUrgent: false 
    };
    
    const minutes = Math.floor(timeLeft / (1000 * 60));
    const hours = Math.floor(minutes / 60);
    
    if (minutes <= 30) {
      return {
        text: '', 
        color: 'text-red-500',
        isUrgent: true,
        tooltip: `⚠️ Deadline in ${minutes} minute${minutes === 1 ? '' : 's'}!`
      };
    }
    
    if (hours < 24) {
      return {
        text: `${hours}h ${minutes % 60}m left`,
        color: hours < 2 ? 'text-red-500' : 'text-orange-500',
        isUrgent: false
      };
    }
    
    const days = Math.floor(hours / 24);
    return {
      text: `${days} days left`,
      color: 'text-green-500',
      isUrgent: false
    };
  }

  // Update date formatting
  const formatDateForDisplay = (date: Date | undefined) => {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
      return null;
    }
    try {
      return format(date, 'MMM d, yyyy @ h:mm a');
    } catch (error) {
      console.error('Date formatting error:', error);
      return null;
    }
  }

  const handleAddTask = ({ text, date, time }: { text: string; date: string; time: string }) => {
    updateChecklist(id, {
      items: [
        ...items,
        {
          id: Date.now().toString(),
          text,
          completed: false,
          deadline: date && time ? new Date(`${date}T${time}:00`) : undefined,
          timeSpent: 0,
          isTracking: false,
        },
      ],
    });
  };

  const handleEditTask = (taskId: string, { text, date, time }: { text: string; date: string; time: string }) => {
    updateItem(id, taskId, {
      text,
      deadline: date && time ? new Date(`${date}T${time}:00`) : undefined,
    });
  };

    function formatDateForInput(deadline: Date): string {
        if (!deadline || !(deadline instanceof Date) || isNaN(deadline.getTime())) {
            return '';
        }
        return deadline.toISOString().split('T')[0];
    }

    function formatTimeForInput(deadline: Date): string {
        if (!deadline || !(deadline instanceof Date) || isNaN(deadline.getTime())) {
            return '';
        }
        return deadline.toTimeString().slice(0, 5);
    }

  // Base sizes for scaling
  const baseWidth = 320 // Base width in pixels
  const baseFontSize = 14
  const baseIconSize = 16
  const baseSpacing = 16

  // Use base dimensions — parent scale(zoom) handles visual scaling
  const scaledWidth = baseWidth * zoom
  const scaledFontSize = baseFontSize * zoom
  const scaledIconSize = baseIconSize * zoom
  const scaledSpacing = baseSpacing * zoom

  const getConnectionSide = () => {
    const connection = connections.find(conn => conn.fromId === id || conn.toId === id)
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
    type: 'checklist' as const, id, get position() { return positionRef.current }, width,
  }), [id, width])

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `checklist-${id}`,
    disabled: !isDragEnabled || isViewOnly,
    data: stableData,
  })

  const zoomedTransform = transform ? { ...transform, x: transform.x / (zoom * vScale), y: transform.y / (zoom * vScale) } : null

  const style = {
    transform: CSS.Translate.toString(zoomedTransform),
    position: 'absolute' as const,
    left: position.x * vScale,
    top: position.y * vScale,
    fontSize: `${scaledFontSize}px`,
    padding: `${scaledSpacing * 1.25}px`,
    touchAction: 'none' as const,
    boxShadow: '0 10px 40px rgba(0, 0, 0, 0.15)',
    scrollMargin: 0,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10000 : zIndex,
    borderRadius: `${24 * zoom}px`,
    willChange: isDragging ? 'transform' as const : 'auto' as const,
  }

  return (
    <>
      <div
        style={style}
        data-node-id={id}
        data-item-id={id}
        onMouseDown={() => { if (!isDragging) bringToFront(id) }}
      >
        <Resizable
          size={{ width: width * vScale, height: height * vScale }}
          onResizeStop={handleResizeStop}
          minWidth={280 * vScale}
          minHeight={200 * vScale}
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
            right: {
              right: '-4px',
              width: '8px',
              cursor: 'ew-resize',
            },
            bottom: {
              bottom: '-4px',
              height: '8px',
              cursor: 'ns-resize',
            },
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
            onClick={() => setShowNodes(true)}
            onBlur={() => setShowNodes(false)}
            className={`
              w-full h-full p-5 rounded-3xl ${color}
              backdrop-blur-md border item-container checklist overflow-hidden relative
              flex flex-col
              ${isSelected ? 'border-blue-400/50 ring-2 ring-blue-400/30' : 'border-black/10'}
              ${isConnected ? 'ring-1 ring-blue-400/50' : ''}
              ${isDragEnabled ? 'cursor-move' : 'cursor-pointer'}
              will-change-transform
            `}
            tabIndex={0}
            onFocus={(e) => e.preventDefault()}
          >
        {isConnected && isVisible && (
          <div 
            className={`
              absolute top-1/2 -translate-y-1/2 w-3 h-3 
              bg-blue-500 rounded-full border-2 border-white 
              shadow-md animate-pulse connection-indicator
              ${getConnectionSide() === 'left' ? '-left-1.5' : '-right-1.5'}
            `}
            data-connection-id={`${id}-indicator`}
            data-connection-side={getConnectionSide()}
          />
        )}
        <ConnectionNode id={id} type="checklist" position={position} side="left" isVisible={showNodes} />
        <ConnectionNode id={id} type="checklist" position={position} side="right" isVisible={showNodes} />
        <div className="flex justify-between items-start mb-5 relative">
          <GripVertical
            size={18}
            className="text-gray-400 shrink-0 mt-1.5"
          />
          {isEditingTitle ? (
            <input
              type="text"
              value={editTitleValue}
              onChange={(e) => setEditTitleValue(e.target.value)}
              style={{ fontSize: `${scaledFontSize * 1.25}px` }}
              className="font-semibold text-gray-800 bg-white/80 rounded-lg px-2 py-1 border border-zinc-300 focus:ring-2 focus:ring-blue-400/50 focus:outline-none flex-1"
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && editTitleValue.trim()) {
                  updateChecklist(id, { title: editTitleValue.trim() })
                  setIsEditingTitle(false)
                }
                if (e.key === 'Escape') {
                  setEditTitleValue(title)
                  setIsEditingTitle(false)
                }
              }}
              onBlur={() => {
                if (editTitleValue.trim()) updateChecklist(id, { title: editTitleValue.trim() })
                setIsEditingTitle(false)
              }}
            />
          ) : (
            <h3
              style={{ fontSize: `${scaledFontSize * 1.25}px` }}
              className="font-semibold text-gray-800 checklist-title cursor-pointer hover:bg-white/40 rounded-lg px-2 py-1 transition-colors"
              onDoubleClick={(e) => {
                e.stopPropagation()
                if (isViewOnly) return
                setEditTitleValue(title)
                setIsEditingTitle(true)
              }}
              title={isViewOnly ? title : "Double-click to rename"}
            >
              {title}
            </h3>
          )}
          {!isViewOnly && (
          <div className="flex items-center gap-1">
            <button
              ref={colorBtnRef}
              onClick={(e) => {
                e.stopPropagation()
                setShowColorPicker(!showColorPicker)
              }}
              className="p-2.5 hover:bg-purple-50 rounded-xl transition-all duration-200 hover:scale-110 group"
              title="Change checklist color"
            >
              <Palette size={scaledIconSize} className="text-gray-400 group-hover:text-purple-500 transition-colors" />
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2.5 hover:bg-red-50 rounded-xl transition-all duration-200 hover:scale-110 group"
              title="Delete checklist"
            >
              <Trash2 size={scaledIconSize} className="text-gray-400 group-hover:text-red-500 transition-colors" />
            </button>
          </div>
          )}

          {/* Color Picker */}
          {showColorPicker && (
            <ColorPicker
              currentColor={color}
              onSelect={(c) => updateChecklist(id, { color: c })}
              onClose={() => setShowColorPicker(false)}
              triggerRef={colorBtnRef}
            />
          )}
        </div>

        <div 
          ref={itemsContainerRef}
          className="space-y-2.5 checklist-tasks overflow-auto flex-1 min-h-0"
        >
          {items.map((item, index) => (
            <div 
              key={item.id} 
              className="relative bg-white/60 backdrop-blur-sm rounded-xl task-item border border-white/50 hover:shadow-md transition-all duration-200 group/item"
              style={{ padding: `${scaledSpacing * 0.6}px ${scaledSpacing * 0.75}px`, boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)' }}
            >
              {/* Main row: checkbox + content */}
              <div className="flex items-start gap-2">
                <button
                  onClick={() => {
                    if (isViewOnly) return
                    toggleItem(id, item.id)
                    // Sync to TaskAssignment (fire-and-forget)
                    useDelegationStore.getState().syncOwnerChecklistToggle(item.id, !item.completed)
                  }}
                  disabled={isViewOnly}
                  className={`
                    p-1 rounded-md transition-all duration-200 mt-0.5 flex-shrink-0 hover:scale-110
                    ${item.completed ? 'bg-green-500 text-white shadow-sm' : 'bg-white/80 hover:bg-white border border-black/10'}
                    ${isViewOnly ? 'cursor-default hover:scale-100' : ''}
                  `}
                >
                  <Check size={12} className={item.completed ? '' : 'text-gray-400'} />
                </button>
                
                <div className="flex-1 min-w-0">
                  <p
                    contentEditable={!isViewOnly}
                    suppressContentEditableWarning
                    onBlur={(e) => {
                      if (isViewOnly) return
                      const newText = e.currentTarget.textContent || ''
                      if (newText.trim() !== item.text) {
                        updateItem(id, item.id, { text: newText.trim() })
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        ;(e.target as HTMLElement).blur()
                      }
                    }}
                    className={`text-sm font-medium leading-snug outline-none ${
                      item.completed ? 'text-gray-400 line-through' : 'text-gray-800'
                    }`}
                  >
                    {item.text}
                  </p>
                  
                  {/* Deadline + time status + assignee dots */}
                  {(item.deadline || false) && (
                    <div className="flex items-center flex-wrap gap-1.5 mt-1">
                      {item.deadline && formatDateForDisplay(item.deadline) && (
                        <div className="text-[10px] text-gray-500 flex items-center gap-1 bg-blue-50/60 rounded-md px-1.5 py-0.5">
                          <Clock size={10} className="text-blue-400" />
                          <span>{formatDateForDisplay(item.deadline)}</span>
                        </div>
                      )}
                      
                      {!item.completed && getTimeStatus(item) && !getTimeStatus(item)?.isUrgent && (
                        <span className={`text-[10px] font-medium ${getTimeStatus(item)?.color}`}>
                          {getTimeStatus(item)?.text}
                        </span>
                      )}
                      
                      {!item.completed && getTimeStatus(item)?.isUrgent && (
                        <span className="text-[10px] font-semibold text-red-500 animate-pulse">
                          {getTimeStatus(item)?.tooltip}
                        </span>
                      )}

                      {item.completed && (
                        <span className="text-[10px] font-medium text-green-600">✓ Done</span>
                      )}
                    </div>
                  )}

                  {/* Assignee dots (always check, separate from deadline) */}
                  <AssigneeCompletionDots sourceId={item.id} />
                </div>
              </div>

              {/* Hover actions — desktop: pill on hover; touch: three-dot popup */}
              {/* Desktop hover pill */}
              {!isViewOnly && <div className="absolute bottom-1 right-1 opacity-0 group-hover/item:opacity-100 transition-all duration-150 z-[9999] touch-hidden">
                <div className="flex items-center gap-px bg-white/95 backdrop-blur-md rounded-lg shadow-md border border-black/10 px-1 py-0.5">
                  <button
                    onClick={() => { if (index > 0) reorderItem(id, index, index - 1) }}
                    disabled={index === 0}
                    className="p-1 rounded hover:bg-black/5 disabled:opacity-20 transition-all"
                    title="Move up"
                  >
                    <ChevronUp size={11} className="text-gray-500" />
                  </button>
                  <button
                    onClick={() => { if (index < items.length - 1) reorderItem(id, index, index + 1) }}
                    disabled={index === items.length - 1}
                    className="p-1 rounded hover:bg-black/5 disabled:opacity-20 transition-all"
                    title="Move down"
                  >
                    <ChevronDown size={11} className="text-gray-500" />
                  </button>
                  <AssignButton
                    sourceType="checklist_item"
                    sourceId={item.id}
                    content={item.text}
                    size={11}
                    className="p-1 rounded"
                  />
                  <button
                    onClick={() => setEditingTask(item)}
                    className="p-1 text-gray-400 hover:text-blue-500 rounded transition-all"
                    title="Edit"
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={() => {
                      updateChecklist(id, {
                        items: items.filter(i => i.id !== item.id)
                      })
                    }}
                    className="p-1 text-gray-400 hover:text-red-500 rounded transition-all"
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>}

              {/* Touch-only three-dot popup menu */}
              {!isViewOnly && <TouchTaskMenu
                index={index}
                total={items.length}
                onMoveUp={() => { if (index > 0) reorderItem(id, index, index - 1) }}
                onMoveDown={() => { if (index < items.length - 1) reorderItem(id, index, index + 1) }}
                onEdit={() => setEditingTask(item)}
                onDelete={() => updateChecklist(id, { items: items.filter(i => i.id !== item.id) })}
                assignButton={
                  <AssignButton
                    sourceType="checklist_item"
                    sourceId={item.id}
                    content={item.text}
                    size={14}
                    label="Assign"
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                  />
                }
              />}
            </div>
          ))}
        </div>

        {hasOverflow && (
          <div 
            onClick={(e) => {
              e.stopPropagation()
              if (itemsContainerRef.current) {
                itemsContainerRef.current.scrollTo({
                  top: itemsContainerRef.current.scrollTop + 100,
                  behavior: 'smooth'
                })
              }
            }}
            className="absolute bottom-8 right-6 flex items-center gap-1 text-xs font-medium cursor-pointer hover:opacity-70 transition-opacity z-[9999]"
            style={{ color: color.includes('white') || color.includes('yellow') ? '#666' : color.includes('blue') ? '#1e40af' : color.includes('green') ? '#15803d' : color.includes('purple') ? '#6b21a8' : color.includes('pink') ? '#be185d' : color.includes('orange') ? '#c2410c' : '#555' }}>
            More
            <ChevronDown size={14} />
          </div>
        )}

        {!hasOverflow && !isViewOnly && (
          <button
            onClick={() => setShowAddTaskModal(true)}
            className="mt-2 text-sm text-gray-600 hover:text-gray-800 font-semibold hover:bg-white/50 rounded-xl px-3 py-1.5 transition-all duration-200 hover:scale-105 hover:shadow-sm"
            style={{ fontSize: `${scaledFontSize * 0.875}px` }}
          >
            + Add item
          </button>
        )}
        </div>
      </Resizable>

      {hasOverflow && !isViewOnly && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowAddTaskModal(true)
          }}
          className="absolute -bottom-12 left-0 right-0 mx-auto w-fit text-sm text-gray-600 hover:text-gray-800 font-semibold bg-white/90 hover:bg-white/95 backdrop-blur-sm rounded-xl px-4 py-2 transition-all duration-200 hover:scale-105 shadow-lg border border-black/10"
          style={{ fontSize: `${scaledFontSize * 0.875}px` }}
        >
          + Add item
        </button>
      )}
    </div>

      {showAddTaskModal && (
        <TaskModal
          title="Add New Task"
          onClose={() => setShowAddTaskModal(false)}
          onSubmit={handleAddTask}
        />
      )}

      {editingTask && (
        <TaskModal
          title="Edit Task"
          initialData={{
            text: editingTask.text,
            date: editingTask.deadline ? formatDateForInput(editingTask.deadline) : '',
            time: editingTask.deadline ? formatTimeForInput(editingTask.deadline) : '',
          }}
          onClose={() => setEditingTask(null)}
          onSubmit={(data) => handleEditTask(editingTask.id, data)}
        />
      )}

      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onConfirm={() => {
          removeConnectionsByItemId(id)
          deleteChecklist(id)
          useZIndexStore.getState().removeItem(id)
          setShowDeleteConfirm(false)
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        itemName={title}
        itemType="checklist"
      />
    </>
  )
}
