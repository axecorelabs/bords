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
  useValue,
  type SvgExportContext,
} from 'tldraw'
import { useState, useRef, useEffect, useCallback } from 'react'
import { Trash2, Palette, RotateCw, RotateCcw, Plus, Minus } from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal'
import { ConnectionLinkButton, ConnectionSelectionRing, ConnectionIndicator } from './ConnectionLink'
import type { BordsText } from './bordsShapeTypes'
import { wrapTextForSvg } from './bordsShapeTypes'

/* ── Shape Util ── */
export class BordsTextUtil extends ShapeUtil<BordsText> {
  static override type = 'bords-text' as const

  static override props: RecordProps<BordsText> = {
    w: T.number,
    h: T.number,
    text: T.string,
    fontSize: T.number,
    color: T.string,
    rotation: T.number,
    textId: T.string,
  }

  getDefaultProps(): BordsText['props'] {
    return {
      w: 200,
      h: 40,
      text: 'Double-click to edit',
      fontSize: 16,
      color: '#1f2937',
      rotation: 0,
      textId: '',
    }
  }

  getGeometry(shape: BordsText) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  component(shape: BordsText) {
    return <TextComponent shape={shape} />
  }

  indicator(shape: BordsText) {
    return (
      <rect
        rx={4}
        ry={4}
        width={shape.props.w}
        height={shape.props.h}
        fill="none"
      />
    )
  }

  override canResize() {
    return true
  }

  override onResize(shape: BordsText, info: TLResizeInfo<any>) {
    return resizeBox(shape as any, info)
  }

  override canEdit() {
    return true
  }

  /* ── SVG export — pure SVG text, no foreignObject ── */
  override toSvg(shape: BordsText, _ctx: SvgExportContext) {
    const { w, h, text, fontSize, color } = shape.props
    const pad = 8
    const lineHeight = fontSize * 1.4
    const lines = wrapTextForSvg(text, w - pad * 2, fontSize)
    const maxLines = Math.floor((h - pad) / lineHeight)
    const visibleLines = lines.slice(0, maxLines)

    return (
      <g>
        {visibleLines.map((line, i) => (
          <text
            key={i}
            x={pad}
            y={pad + fontSize + i * lineHeight}
            fontSize={fontSize}
            fill={color}
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            {line}
          </text>
        ))}
      </g>
    )
  }
}
function TextComponent({ shape }: { shape: BordsText }) {
  const editor = useEditor()
  const { text, fontSize, color, rotation, w, h, textId } = shape.props
  // Use tldraw's editing state — double-click enters edit mode natively
  const isEditing = useValue('isEditing', () => editor.getEditingShapeId() === shape.id, [editor, shape.id])
  const [editText, setEditText] = useState(text)
  const editTextRef = useRef(editText)
  const [showControls, setShowControls] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const colorBtnRef = useRef<HTMLButtonElement>(null)
  const wasEditingRef = useRef(false)

  // Keep ref in sync with state
  useEffect(() => { editTextRef.current = editText }, [editText])

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
      wasEditingRef.current = true
    }
  }, [isEditing])

  // When tldraw exits edit mode (click outside, Escape, etc.), persist the text
  useEffect(() => {
    if (!isEditing && wasEditingRef.current) {
      wasEditingRef.current = false
      const currentEdit = editTextRef.current
      if (currentEdit !== text) {
        editor.updateShape({
          id: shape.id,
          type: 'bords-text',
          props: { text: currentEdit },
        })
      }
    }
  }, [isEditing, editor, shape.id, text])

  // Sync external text changes when not editing
  useEffect(() => {
    if (!isEditing) setEditText(text)
  }, [text, isEditing])

  const handleSave = useCallback(() => {
    // Persist text immediately, then exit edit mode
    if (editText !== text) {
      editor.updateShape({
        id: shape.id,
        type: 'bords-text',
        props: { text: editText },
      })
    }
    wasEditingRef.current = false // prevent double-save from the effect
    editor.setEditingShape(null)
  }, [editor, shape.id, editText, text])

  const handleFontSize = useCallback((delta: number) => {
    const newSize = Math.max(8, Math.min(72, fontSize + delta))
    editor.updateShape({
      id: shape.id,
      type: 'bords-text',
      props: { fontSize: newSize },
    })
  }, [editor, shape.id, fontSize])

  const handleRotate = useCallback((delta: number) => {
    editor.updateShape({
      id: shape.id,
      type: 'bords-text',
      props: { rotation: rotation + delta },
    })
  }, [editor, shape.id, rotation])

  const handleColorChange = useCallback((newColor: string) => {
    editor.updateShape({
      id: shape.id,
      type: 'bords-text',
      props: { color: newColor },
    })
  }, [editor, shape.id])

  const handleDelete = useCallback(() => {
    editor.deleteShape(shape.id)
    setShowDeleteConfirm(false)
  }, [editor, shape.id])

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        width: w,
        height: h,
        pointerEvents: 'all',
      }}
    >
      <div
        data-node-id={textId}
        data-item-id={textId}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={(e) => {
          // Don't hide controls if mouse moves to the toolbar area above
          const rect = e.currentTarget.getBoundingClientRect()
          const toolbarTop = rect.top - 48
          if (e.clientY >= toolbarTop && e.clientY <= rect.bottom && e.clientX >= rect.left - 40 && e.clientX <= rect.right + 40) return
          setShowControls(false)
        }}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          // Extend hover zone upward to cover toolbar gap
          paddingTop: showControls ? 0 : 0,
        }}
      >
        {/* Invisible hover bridge to toolbar */}
        {showControls && !isEditing && (
          <div
            style={{
              position: 'absolute',
              top: -48,
              left: -20,
              right: -20,
              height: 48,
              zIndex: 5,
            }}
          />
        )}
        {/* Connection indicator — dynamic side */}
        <ConnectionIndicator itemId={textId} />
        {/* Connection selection ring */}
        <ConnectionSelectionRing itemId={textId} />

        {/* Toolbar on hover */}
        {showControls && !isEditing && (
          <div
            style={{
              position: 'absolute',
              top: -40,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(255,255,255,0.9)',
              backdropFilter: 'blur(12px)',
              borderRadius: 9999,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              border: '1px solid rgba(0,0,0,0.1)',
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              padding: '4px 8px',
              zIndex: 10,
              whiteSpace: 'nowrap',
            }}
          >
            {/* Font size controls */}
            <button
              style={{ padding: 6, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Decrease font size"
              onPointerDown={(e) => { e.stopPropagation(); handleFontSize(-2) }}
            >
              <Minus size={12} color="#6b7280" />
            </button>
            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, minWidth: 28, textAlign: 'center' }}>
              {fontSize}px
            </span>
            <button
              style={{ padding: 6, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Increase font size"
              onPointerDown={(e) => { e.stopPropagation(); handleFontSize(2) }}
            >
              <Plus size={12} color="#6b7280" />
            </button>

            <div style={{ width: 1, height: 16, background: '#e5e7eb', margin: '0 2px' }} />

            {/* Rotation */}
            <button
              style={{ padding: 6, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Rotate left"
              onPointerDown={(e) => { e.stopPropagation(); handleRotate(-15) }}
            >
              <RotateCcw size={12} color="#6b7280" />
            </button>
            <span style={{ fontSize: 10, color: '#9ca3af', minWidth: 24, textAlign: 'center' }}>
              {rotation}°
            </span>
            <button
              style={{ padding: 6, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Rotate right"
              onPointerDown={(e) => { e.stopPropagation(); handleRotate(15) }}
            >
              <RotateCw size={12} color="#6b7280" />
            </button>

            <div style={{ width: 1, height: 16, background: '#e5e7eb', margin: '0 2px' }} />

            {/* Color */}
            <button
              ref={colorBtnRef}
              style={{
                padding: 4,
                border: '2px solid #e5e7eb',
                background: color,
                cursor: 'pointer',
                borderRadius: 9999,
                width: 20,
                height: 20,
              }}
              title="Change color"
              onPointerDown={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker) }}
            />

            <div style={{ width: 1, height: 16, background: '#e5e7eb', margin: '0 2px' }} />

            {/* Connection link */}
            <ConnectionLinkButton itemId={textId} itemType="text" style={{ padding: 6 }} size={12} />

            <div style={{ width: 1, height: 16, background: '#e5e7eb', margin: '0 2px' }} />

            {/* Delete */}
            <button
              style={{ padding: 6, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Delete text"
              onPointerDown={(e) => { e.stopPropagation(); setShowDeleteConfirm(true) }}
            >
              <Trash2 size={12} color="#dc2626" />
            </button>
          </div>
        )}

        {/* Text body */}
        <div
          style={{
            width: '100%',
            height: '100%',
            transform: `rotate(${rotation}deg)`,
            transformOrigin: 'center center',
          }}
        >
          {isEditing ? (
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleSave()
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSave()
                }
                e.stopPropagation()
              }}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                width: '100%',
                height: '100%',
                resize: 'none',
                border: '2px solid #3b82f6',
                borderRadius: 8,
                padding: 8,
                fontFamily: 'inherit',
                fontSize,
                fontWeight: 500,
                color,
                backgroundColor: 'rgba(255,255,255,0.5)',
                outline: 'none',
              }}
            />
          ) : (
            <div
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color,
                fontWeight: 500,
                fontSize,
                lineHeight: 1.5,
                userSelect: 'none',
                cursor: 'text',
                padding: 4,
              }}
            >
              {text}
            </div>
          )}
        </div>

        {/* Color Picker (portal) */}
        {showColorPicker && (
          <ColorPicker
            currentColor={color}
            onSelect={handleColorChange}
            onClose={() => setShowColorPicker(false)}
            useHex
            triggerRef={colorBtnRef}
          />
        )}
      </div>

      {/* Delete Confirmation */}
      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        itemName={text.slice(0, 40)}
        itemType="text"
      />
    </HTMLContainer>
  )
}
