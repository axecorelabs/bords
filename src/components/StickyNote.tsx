'use client'
import { Trash2, Edit2, Palette, ChevronDown, GripVertical } from 'lucide-react'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Resizable } from 're-resizable'
import { useNoteStore, StickyNote as StickyNoteType } from '../store/stickyNoteStore'
import { useDragModeStore } from '../store/dragModeStore'
import { useConnectionStore } from '../store/connectionStore';
import { ConnectionNode } from './ConnectionNode'
import { useGridStore } from '../store/gridStore';
import { StickyNoteEditModal } from './StickyNoteEditModal'
import { useZIndexStore } from '../store/zIndexStore'
import { DeleteConfirmModal } from './DeleteConfirmModal'
import { ColorPicker } from './ColorPicker'
import { AssignButton } from './delegation/AssignButton'
import { useViewportScale } from '../hooks/useViewportScale'
import { useIsViewOnly } from '@/lib/useIsViewOnly'

interface StickyNoteProps extends StickyNoteType {}



export function StickyNote({ id, text, position, color, width = 192, height }: StickyNoteProps) {
  const [showControls, setShowControls] = useState(false)
  const [showNodes, setShowNodes] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const [hasOverflow, setHasOverflow] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const textContainerRef = useRef<HTMLDivElement>(null)
  const { updateNote, deleteNote } = useNoteStore()
  const isDragEnabled = useDragModeStore((state) => state.isDragEnabled)
  const { selectedItems, selectItem, deselectItem, isVisible, removeConnectionsByItemId } = useConnectionStore();
  const isSelected = selectedItems.some(item => item.id === id);
  const zoom = useGridStore((state) => state.zoom)
  const connections = useConnectionStore((state) => state.connections)
  const isConnected = connections.some(conn => conn.fromId === id || conn.toId === id)
  const { bringToFront, getZIndex } = useZIndexStore()
  const zIndex = useZIndexStore((state) => state.zIndexMap[id] || 1)
  const vScale = useViewportScale()
  const isViewOnly = useIsViewOnly()

  // Calculate minimum height based on text content
  const calculateMinHeight = () => {
    const lineHeight = 20
    const padding = 60 // Top and bottom padding + label space
    const lines = text.split('\n').length
    return Math.max(100, (lines * lineHeight) + padding)
  }

  // Calculate default height if not set
  const calculateDefaultHeight = () => {
    if (height) return height
    return calculateMinHeight()
  }

  const noteHeight = calculateDefaultHeight()
  const minHeight = calculateMinHeight()

  // Check if text content overflows
  useEffect(() => {
    const checkOverflow = () => {
      if (textContainerRef.current) {
        const { scrollHeight, clientHeight } = textContainerRef.current
        setHasOverflow(scrollHeight > clientHeight + 5) // 5px buffer
      }
    }
    
    checkOverflow()
    // Recheck when text or height changes
  }, [text, noteHeight])

  // Stabilise drag-start position so mid-drag re-renders never shift the origin
  const positionRef = useRef(position)
  positionRef.current = position
  const stableData = useMemo(() => ({
    type: 'note' as const, id, get position() { return positionRef.current }, width,
  }), [id, width])

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `note-${id}`,
    disabled: !isDragEnabled || isViewOnly,
    data: stableData,
  })

  const handleResizeStop = (e: any, direction: any, ref: any, d: any) => {
    if (isViewOnly) return
    updateNote(id, {
      width: width + Math.round(d.width / vScale),
      height: noteHeight + Math.round(d.height / vScale)
    })
  }

  const handleDoubleClick = () => {
    if (isSelected) {
      deselectItem(id);
    } else {
      selectItem(id, 'note', position);
    }
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isViewOnly) return
    setShowEditModal(true)
  }

  const handleSaveEdit = (newText: string) => {
    updateNote(id, { text: newText })
  }

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

  // Adjust drag transform for zoom — dnd-kit reports screen‑px but we're inside scale(zoom)
  const zoomedTransform = transform ? { ...transform, x: transform.x / (zoom * vScale), y: transform.y / (zoom * vScale) } : null

  const style = {
    transform: CSS.Translate.toString(zoomedTransform),
    position: 'absolute' as const,
    left: position.x * vScale,
    top: position.y * vScale,
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
    scrollMargin: 0,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10000 : zIndex,
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
          size={{ width: width * vScale, height: noteHeight * vScale }}
          onResizeStop={handleResizeStop}
          minWidth={150 * vScale}
          minHeight={minHeight * vScale}
          enable={{
            top: false,
            right: !isDragging && !isViewOnly,
            bottom: !isDragging && !isViewOnly,
            left: false,
            topRight: false,
            bottomRight: !isDragging && !isViewOnly,
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
              w-full h-full p-5 rounded-2xl sticky-note
              ${color} select-none relative
              backdrop-blur-sm border item-container
              ${isSelected ? 'border-blue-400/50 ring-2 ring-blue-400/30' : 'border-black/10'}
              ${isConnected ? 'ring-1 ring-blue-400/50' : ''}
              ${isDragEnabled ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
              will-change-transform
            `}
            style={{ touchAction: 'none' }}
            tabIndex={0}
            onFocus={(e) => e.preventDefault()}
            onMouseEnter={() => setShowControls(true)}
            onMouseLeave={() => setShowControls(false)}
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
        
        {/* Connection Nodes */}
        <ConnectionNode id={id} type="note" position={position} side="left" isVisible={showNodes} />
        <ConnectionNode id={id} type="note" position={position} side="right" isVisible={showNodes} />

        <div className="absolute -top-2 -left-2 bg-gradient-to-r from-zinc-700 to-zinc-600 text-white text-[10px] px-2 py-1 rounded-full font-medium shadow-md">
          Sticky Note
        </div>

        {/* Drag Handle — touch-safe fallback when text area is scrollable */}
        <div
          {...listeners}
          {...attributes}
          className={`absolute top-1.5 right-1.5 p-1 rounded-md z-10 transition-colors ${
            isDragEnabled
              ? 'cursor-grab active:cursor-grabbing text-gray-500 hover:text-gray-700 hover:bg-black/5'
              : 'text-gray-300 pointer-events-none'
          }`}
          style={{ touchAction: 'none' }}
          title={isDragEnabled ? 'Drag to move' : ''}
        >
          <GripVertical size={14} />
        </div>

        <div 
          ref={textContainerRef}
          className="note-content whitespace-pre-wrap break-words text-gray-800 select-none font-medium overflow-auto max-h-full pr-2"
          style={{ touchAction: 'pan-y' }}
        >
          {text}
        </div>

        {/* Read More Indicator */}
        {hasOverflow && (
          <div className={`absolute bottom-2 right-2 flex items-center gap-1 ${color} text-gray-800 text-[10px] px-2 py-1 rounded-full font-medium shadow-md border border-black/10`}>
            <span>More</span>
            <ChevronDown size={10} />
          </div>
        )}

        {showControls && !isViewOnly && (
          <div 
            className="absolute -top-2 -right-2 bg-white/80 backdrop-blur-md rounded-full shadow-lg border border-black/10 flex overflow-hidden"
          >
            <button
              onClick={handleEdit}
              className="p-2.5 hover:bg-blue-500/10 transition-all duration-200 hover:scale-110"
              title="Edit note"
            >
              <Edit2 size={14} className="text-blue-600" />
            </button>
            <div className="w-px bg-gray-200" />
            <button
              ref={colorBtnRef}
              onClick={(e) => {
                e.stopPropagation()
                setShowColorPicker(!showColorPicker)
              }}
              className="p-2.5 hover:bg-purple-500/10 transition-all duration-200 hover:scale-110 relative"
              title="Change color"
            >
              <Palette size={14} className="text-purple-600" />
            </button>
            <div className="w-px bg-gray-200" />
            <div className="w-px bg-gray-200" />
            <AssignButton
              sourceType="note"
              sourceId={id}
              content={text}
              size={14}
              className="p-2.5 hover:scale-110"
            />
            <div className="w-px bg-gray-200" />
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-2.5 hover:bg-red-500/10 transition-all duration-200 hover:scale-110"
              title="Delete note"
            >
              <Trash2 size={14} className="text-red-600" />
            </button>
          </div>
        )}

        {/* Color Picker */}
        {showColorPicker && (
          <ColorPicker
            currentColor={color}
            onSelect={(c) => updateNote(id, { color: c })}
            onClose={() => setShowColorPicker(false)}
            triggerRef={colorBtnRef}
          />
        )}
        </div>
      </Resizable>
    </div>

      {/* Edit Modal */}
      {showEditModal && (
        <StickyNoteEditModal
          initialText={text}
          color={color}
          onClose={() => setShowEditModal(false)}
          onSave={handleSaveEdit}
        />
      )}

      {/* Delete Confirmation */}
      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onConfirm={() => {
          removeConnectionsByItemId(id)
          deleteNote(id)
          useZIndexStore.getState().removeItem(id)
          setShowDeleteConfirm(false)
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        itemName={text.slice(0, 40)}
        itemType="note"
      />
    </>
  )
}
