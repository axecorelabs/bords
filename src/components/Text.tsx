'use client'
import { useState, useRef, useEffect, useMemo } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Resizable } from 're-resizable'
import { useTextStore, TextElement } from '../store/textStore'
import { useDragModeStore } from '../store/dragModeStore'
import { Trash2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'
import { useGridStore } from '../store/gridStore'
import { useThemeStore } from '../store/themeStore'
import { useConnectionStore } from '../store/connectionStore'
import { useZIndexStore } from '../store/zIndexStore'
import { useViewportScale } from '../hooks/useViewportScale'
import { ColorPicker } from './ColorPicker'
import { useIsViewOnly } from '@/lib/useIsViewOnly'

export function Text({ id, text, position, fontSize, color, rotation = 0, width = 200 }: TextElement & { rotation?: number }) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSelected, setIsSelected] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const { bringToFront } = useZIndexStore()
  const zIndex = useZIndexStore((state) => state.zIndexMap[id] || 1)
  const textRef = useRef<HTMLDivElement>(null);
  const { updateText, deleteText } = useTextStore()
  const isDragEnabled = useDragModeStore((state) => state.isDragEnabled)
  const zoom = useGridStore((state) => state.zoom)
  const isDark = useThemeStore((state) => state.isDark)
  const { removeConnectionsByItemId } = useConnectionStore()
  const vScale = useViewportScale()
  const isViewOnly = useIsViewOnly()

  const handleResizeStop = (_e: any, _dir: any, _ref: any, d: any) => {
    if (isViewOnly) return
    updateText(id, { width: width + Math.round(d.width / vScale) })
  }

  const positionRef = useRef(position)
  positionRef.current = position
  const stableData = useMemo(() => ({
    type: 'text' as const, id, get position() { return positionRef.current }, rotation: rotation || 0, width,
  }), [id, rotation, width])

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `text-${id}`,
    disabled: !isDragEnabled,
    data: stableData,
  })

  const adjustFontSize = (delta: number) => {
    updateText(id, {
      fontSize: Math.max(8, Math.min(72, fontSize + delta))
    })
  }

  const rotateClockwise = () => {
    updateText(id, {
      rotation: ((rotation || 0) + 15) % 360
    })
  }

  const rotateCounterClockwise = () => {
    updateText(id, {
      rotation: ((rotation || 0) - 15 + 360) % 360
    })
  }

  useEffect(() => {
    const handleClickOutside = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`[data-text-id="${id}"]`)) {
        setIsSelected(false);
        setShowColorPicker(false);
      }
    };

    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [id]);

  const zoomedTransform = transform ? { ...transform, x: transform.x / (zoom * vScale), y: transform.y / (zoom * vScale) } : null

  const style = {
    transform: CSS.Translate.toString(zoomedTransform),
    position: 'absolute' as const,
    left: position.x * vScale,
    top: position.y * vScale,
    touchAction: 'none' as const,
    userSelect: 'none' as const,
    WebkitUserSelect: 'none' as const,
    scrollMargin: 0,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10000 : zIndex,
    willChange: isDragging ? 'transform' as const : 'auto' as const,
  }

  return (
    <div
      style={style}
      data-node-id={id}
      data-text-id={id}
      data-item-id={id}
      onMouseDown={() => { if (!isDragging) bringToFront(id) }}
    >
      <Resizable
        size={{ width: width * vScale, height: 'auto' }}
        onResizeStop={handleResizeStop}
        minWidth={80 * vScale}
        enable={{
          top: false,
          right: !isDragging && !isViewOnly,
          bottom: false,
          left: false,
          topRight: false,
          bottomRight: false,
          bottomLeft: false,
          topLeft: false,
        }}
        handleStyles={{
          right: {
            right: '-6px',
            width: '16px',
            cursor: 'ew-resize',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          },
        }}
        handleComponent={{
          right: (
            <div
              className="group/resize"
              style={{
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'ew-resize',
              }}
            >
              {/* Visible resize grip — dots that appear on hover/select */}
              <div
                className={`flex flex-col gap-[3px] transition-opacity duration-150 ${
                  isSelected || isHovered ? 'opacity-60' : 'opacity-0 group-hover/resize:opacity-40'
                }`}
                style={{ pointerEvents: 'none' }}
              >
                <div className="w-[3px] h-[3px] rounded-full bg-gray-400" />
                <div className="w-[3px] h-[3px] rounded-full bg-gray-400" />
                <div className="w-[3px] h-[3px] rounded-full bg-gray-400" />
              </div>
            </div>
          ),
        }}
      >
        <div
          ref={setNodeRef}
          {...attributes}
          style={{ rotate: `${rotation || 0}deg` }}
          className={`select-none will-change-transform ${
            isSelected 
              ? 'ring-2 ring-blue-400/50 rounded-lg shadow-lg' 
              : isHovered ? 'ring-1 ring-blue-300/30 rounded-lg' : ''
          }`}
          onPointerDown={(e) => {
            bringToFront(id);
            (listeners as any)?.onPointerDown?.(e);
          }}
          onClick={(e) => {
            e.stopPropagation();
            setIsSelected(true);
          }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onTouchStart={() => setIsSelected(true)}
          onFocus={(e) => e.preventDefault()}
        >
          {isEditing ? (
            <textarea
              autoFocus
              value={text}
              onChange={(e) => updateText(id, { text: e.target.value })}
              onBlur={() => setIsEditing(false)}
              style={{ 
                fontSize: `${fontSize}px`,
                color: isDark ? '#fff' : color,
                width: '100%',
              }}
              className={`w-full p-3 backdrop-blur-sm rounded-lg border-2 border-blue-400/50 focus:ring-0 focus:border-blue-500 resize-none shadow-sm ${
                isDark ? 'bg-zinc-800/90 text-white placeholder:text-gray-400' : 'bg-white/80 text-gray-900'
              }`}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div 
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isViewOnly) setIsEditing(true);
              }}
              onClick={(e) => {
                e.stopPropagation();
                setIsSelected(true);
              }}
              style={{ 
                fontSize: `${fontSize}px`,
                color,
                wordBreak: 'break-word' as const,
              }}
              className="p-3 cursor-text whitespace-pre-wrap select-none hover:bg-white/5 rounded-lg transition-colors"
            >
              {text}
            </div>
          )}
        </div>
      </Resizable>

      {isSelected && !isEditing && !isViewOnly && (
          <div
            className="absolute -top-14 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-white/90 backdrop-blur-md rounded-full shadow-lg border border-black/10 p-1.5 touch-action-bar"
            data-text-id={id}
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
          >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  adjustFontSize(-2);
                }}
                className="p-2 hover:bg-blue-500/10 rounded-full transition-all duration-200 hover:scale-110 min-w-[40px] min-h-[40px] flex items-center justify-center"
                title="Decrease font size"
              >
                <ZoomOut size={16} className="text-gray-700" />
              </button>

              <span className="text-xs font-medium text-gray-600 min-w-[32px] text-center select-none" title="Font size">
                {fontSize}px
              </span>
              
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  adjustFontSize(2);
                }}
                className="p-2 hover:bg-blue-500/10 rounded-full transition-all duration-200 hover:scale-110 min-w-[40px] min-h-[40px] flex items-center justify-center"
                title="Increase font size"
              >
                <ZoomIn size={16} className="text-gray-700" />
              </button>

              <div className="w-px h-6 bg-gray-300" />

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  rotateCounterClockwise();
                }}
                className="p-2 hover:bg-purple-500/10 rounded-full transition-all duration-200 hover:scale-110 min-w-[40px] min-h-[40px] flex items-center justify-center"
                title="Rotate left (15°)"
              >
                <RotateCcw size={16} className="text-purple-600" />
              </button>

              {/* Rotation indicator */}
              <div className="px-2 text-xs font-medium text-gray-600 min-w-[40px] text-center">
                {Math.round(rotation || 0)}°
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  rotateClockwise();
                }}
                className="p-2 hover:bg-purple-500/10 rounded-full transition-all duration-200 hover:scale-110 min-w-[40px] min-h-[40px] flex items-center justify-center"
                title="Rotate right (15°)"
              >
                <RotateCw size={16} className="text-purple-600" />
              </button>

              <div className="w-px h-6 bg-gray-300" />

              {/* Color Picker Button */}
              <div className="relative">
                <button
                  ref={colorBtnRef}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowColorPicker(!showColorPicker);
                  }}
                  className="p-1 hover:bg-gray-100 rounded-full transition-all duration-200 hover:scale-110 relative group"
                  title="Change text color"
                >
                  <div 
                    className="w-6 h-6 rounded-full border-2 border-gray-300 group-hover:border-gray-400 transition-colors shadow-sm"
                    style={{ backgroundColor: color }}
                  />
                </button>
                
                {showColorPicker && (
                  <ColorPicker
                    useHex
                    currentColor={color}
                    onSelect={(newColor) => {
                      updateText(id, { color: newColor });
                      setShowColorPicker(false);
                    }}
                    onClose={() => setShowColorPicker(false)}
                    label="Text Color"
                    triggerRef={colorBtnRef}
                  />
                )}
              </div>

              <div className="w-px h-6 bg-gray-300" />

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeConnectionsByItemId(id);
                  deleteText(id);
                  useZIndexStore.getState().removeItem(id);
                }}
                className="p-2 hover:bg-red-500/10 rounded-full transition-all duration-200 hover:scale-110 min-w-[40px] min-h-[40px] flex items-center justify-center"
                title="Delete text"
              >
                <Trash2 size={16} className="text-red-600" />
              </button>
            </div>
      )}
    </div>
  )
}
