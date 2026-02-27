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
import { useState, useRef, useEffect, useCallback } from 'react'
import { Trash2, Edit2, Palette, ChevronDown, GripVertical } from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal'
import { StickyNoteEditModal } from '@/components/StickyNoteEditModal'
import { ConnectionLinkButton, ConnectionSelectionRing, ConnectionIndicator } from './ConnectionLink'
import { resolveColor, wrapTextForSvg } from './bordsShapeTypes'
import type { BordsStickyNote } from './bordsShapeTypes'

/* ── Shape Util ── */
export class BordsStickyNoteUtil extends ShapeUtil<BordsStickyNote> {
  static override type = 'bords-sticky-note' as const

  static override props: RecordProps<BordsStickyNote> = {
    w: T.number,
    h: T.number,
    text: T.string,
    color: T.string,
    noteId: T.string,
  }

  getDefaultProps(): BordsStickyNote['props'] {
    return {
      w: 192,
      h: 160,
      text: 'New sticky note',
      color: 'bg-yellow-200',
      noteId: '',
    }
  }

  /* ── Geometry for hit-testing & selection ── */
  getGeometry(shape: BordsStickyNote) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  /* ── Rendering ── */
  component(shape: BordsStickyNote) {
    return <StickyNoteComponent shape={shape} />
  }

  /* ── Selection indicator ── */
  indicator(shape: BordsStickyNote) {
    return (
      <rect
        rx={16}
        ry={16}
        width={shape.props.w}
        height={shape.props.h}
        fill="none"
      />
    )
  }

  /* ── Resize support ── */
  override canResize() {
    return true
  }

  override onResize(shape: BordsStickyNote, info: TLResizeInfo<any>) {
    return resizeBox(shape as any, info)
  }

  /* ── Double-click to edit ── */
  override canEdit() {
    return true
  }

  /* ── SVG export — pure SVG, no foreignObject ── */
  override toSvg(shape: BordsStickyNote, _ctx: SvgExportContext) {
    const { w, h, text, color } = shape.props
    const bgColor = resolveColor(color)
    const pad = 12
    const fontSize = 14
    const lineHeight = fontSize * 1.45
    const lines = wrapTextForSvg(text, w - pad * 2, fontSize)
    const maxLines = Math.floor((h - pad * 2) / lineHeight)
    const visibleLines = lines.slice(0, maxLines)

    return (
      <g>
        <rect width={w} height={h} rx={16} ry={16} fill={bgColor} />
        {visibleLines.map((line, i) => (
          <text
            key={i}
            x={pad}
            y={pad + fontSize + i * lineHeight}
            fontSize={fontSize}
            fill="#374151"
            fontFamily="system-ui, -apple-system, sans-serif"
          >
            {line}
          </text>
        ))}
      </g>
    )
  }
}

/* ── React component rendered inside the shape ── */
function StickyNoteComponent({ shape }: { shape: BordsStickyNote }) {
  const editor = useEditor()
  const { text, color, w, h, noteId } = shape.props
  const [showControls, setShowControls] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [hasOverflow, setHasOverflow] = useState(false)
  const textRef = useRef<HTMLDivElement>(null)
  const colorBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (textRef.current) {
      setHasOverflow(textRef.current.scrollHeight > textRef.current.clientHeight)
    }
  }, [text, h])

  const handleSaveEdit = useCallback((newText: string) => {
    editor.updateShape({
      id: shape.id,
      type: 'bords-sticky-note',
      props: { text: newText },
    })
  }, [editor, shape.id])

  const handleColorChange = useCallback((newColor: string) => {
    editor.updateShape({
      id: shape.id,
      type: 'bords-sticky-note',
      props: { color: newColor },
    })
  }, [editor, shape.id])

  const handleDelete = useCallback(() => {
    editor.deleteShape(shape.id)
    setShowDeleteConfirm(false)
  }, [editor, shape.id])

  const bgColor = resolveColor(color)

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        width: w,
        height: h,
        pointerEvents: 'all',
      }}
    >
      {/* Outer wrapper — no overflow hidden so badge & toolbar aren't clipped */}
      <div
        data-node-id={noteId}
        data-item-id={noteId}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
        }}
      >
        {/* Connection indicator — dynamic side based on connected shape position */}
        {/* <ConnectionIndicator itemId={noteId} /> */}
        {/* Connection selection ring */}
        <ConnectionSelectionRing itemId={noteId} />
        {/* Label badge — sits outside the card's overflow boundary */}
        <div
          style={{
            position: 'absolute',
            top: -8,
            left: -8,
            background: 'linear-gradient(to right, #3f3f46, #52525b)',
            color: 'white',
            fontSize: 10,
            padding: '4px 8px',
            borderRadius: 9999,
            fontWeight: 500,
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            zIndex: 2,
            pointerEvents: 'none',
          }}
        >
          Sticky Note
        </div>

        {/* Action toolbar on hover — also outside overflow boundary */}
        {showControls && (
          <div
            style={{
              position: 'absolute',
              top: -8,
              right: -8,
              background: 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(12px)',
              borderRadius: 9999,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              border: '1px solid rgba(0,0,0,0.1)',
              display: 'flex',
              overflow: 'hidden',
              zIndex: 10,
            }}
          >
            <button
              style={{ padding: 10, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Edit note"
              onPointerDown={(e) => {
                e.stopPropagation()
                setShowEditModal(true)
              }}
            >
              <Edit2 size={14} color="#2563eb" />
            </button>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <button
              ref={colorBtnRef}
              style={{ padding: 10, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Change color"
              onPointerDown={(e) => {
                e.stopPropagation()
                setShowColorPicker(!showColorPicker)
              }}
            >
              <Palette size={14} color="#9333ea" />
            </button>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <ConnectionLinkButton itemId={noteId} itemType="note" />
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <button
              style={{ padding: 10, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Delete note"
              onPointerDown={(e) => {
                e.stopPropagation()
                setShowDeleteConfirm(true)
              }}
            >
              <Trash2 size={14} color="#dc2626" />
            </button>
          </div>
        )}

        {/* Card body — has overflow hidden for text content */}
        <div
          style={{
            width: '100%',
            height: '100%',
            backgroundColor: bgColor,
            borderRadius: 16,
            padding: 20,
            position: 'relative',
            border: '1px solid rgba(0,0,0,0.1)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            fontFamily: 'inherit',
          }}
        >
          {/* Drag handle */}
          <div
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              padding: 4,
              borderRadius: 6,
              color: '#9ca3af',
              zIndex: 2,
            }}
          >
            <GripVertical size={14} />
          </div>

          {/* Text content */}
          <div
            ref={textRef}
            onDoubleClick={() => setShowEditModal(true)}
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#1f2937',
              fontWeight: 500,
              fontSize: 14,
              lineHeight: 1.5,
              overflow: 'auto',
              flex: 1,
              userSelect: 'none',
              paddingRight: 8,
              paddingTop: 4,
              cursor: 'text',
            }}
          >
            {text}
          </div>

          {/* Read more indicator */}
          {hasOverflow && (
            <div
              style={{
                position: 'absolute',
                bottom: 8,
                right: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                backgroundColor: bgColor,
                color: '#1f2937',
                fontSize: 10,
                padding: '4px 8px',
                borderRadius: 9999,
                fontWeight: 500,
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                border: '1px solid rgba(0,0,0,0.1)',
              }}
            >
              <span>More</span>
              <ChevronDown size={10} />
            </div>
          )}
        </div>

        {/* Color Picker (portal-based) */}
        {showColorPicker && (
          <ColorPicker
            currentColor={color}
            onSelect={handleColorChange}
            onClose={() => setShowColorPicker(false)}
            triggerRef={colorBtnRef}
          />
        )}
      </div>

      {/* Edit Modal (portal-based) */}
      {showEditModal && (
        <StickyNoteEditModal
          initialText={text}
          color={color}
          onClose={() => setShowEditModal(false)}
          onSave={handleSaveEdit}
        />
      )}

      {/* Delete Confirmation (portal-based) */}
      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        itemName={text.slice(0, 40)}
        itemType="note"
      />
    </HTMLContainer>
  )
}
