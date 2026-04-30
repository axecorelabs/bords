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
import { useState, useCallback, useEffect, useRef } from 'react'
import { useEditor as useTiptapEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import {
  Trash2, Palette, Bold, Italic, UnderlineIcon, List,
  ListOrdered, Heading1, Heading2, ALargeSmall,
} from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal'
import { useRichTextStore } from '@/store/richTextStore'
import { ConnectionLinkButton, ConnectionSelectionRing, ConnectionIndicator } from './ConnectionLink'
import { TAILWIND_COLOR_MAP } from './bordsShapeTypes'
import type { BordsRichText } from './bordsShapeTypes'

/* ── Shape Util ── */
export class BordsRichTextUtil extends ShapeUtil<BordsRichText> {
  static override type = 'bords-rich-text' as const

  static override props: RecordProps<BordsRichText> = {
    w: T.number,
    h: T.number,
    title: T.string,
    color: T.string,
    richTextId: T.string,
  }

  getDefaultProps(): BordsRichText['props'] {
    return {
      w: 480,
      h: 320,
      title: 'Document',
      color: 'bg-white/90',
      richTextId: '',
    }
  }

  getGeometry(shape: BordsRichText) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  component(shape: BordsRichText) {
    return <RichTextComponent shape={shape} />
  }

  indicator(shape: BordsRichText) {
    return (
      <rect
        rx={8}
        ry={8}
        width={shape.props.w}
        height={shape.props.h}
        fill="none"
      />
    )
  }

  override canResize() {
    return true
  }

  override onResize(shape: BordsRichText, info: TLResizeInfo<any>) {
    return resizeBox(shape as any, info)
  }

  override canEdit() {
    return false
  }

  override toSvg(shape: BordsRichText, _ctx: SvgExportContext) {
    const doc = useRichTextStore.getState().docs.find(d => d.id === shape.props.richTextId)
    const text = doc ? extractPlainText(doc.content) : ''
    return (
      <foreignObject x={0} y={0} width={shape.props.w} height={shape.props.h}>
        <div
          style={{
            width: '100%',
            height: '100%',
            padding: '12px',
            fontSize: '13px',
            lineHeight: '1.5',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            background: '#fff',
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        >
          <strong style={{ display: 'block', marginBottom: 4, fontSize: '14px' }}>
            {shape.props.title}
          </strong>
          {text}
        </div>
      </foreignObject>
    )
  }
}

/* ── Plain text extractor (for SVG / search) ── */
function extractPlainText(node: Record<string, any>): string {
  if (!node) return ''
  if (node.type === 'text') return node.text ?? ''
  if (!node.content) return ''
  return (node.content as Array<Record<string, any>>).map(extractPlainText).join('')
}

/* ── Component ── */
function RichTextComponent({ shape }: { shape: BordsRichText }) {
  const tldrawEditor = useEditor()
  const doc = useRichTextStore((s) => s.docs.find(d => d.id === shape.props.richTextId))
  const { updateDoc, deleteDoc } = useRichTextStore()

  const [showBgPicker, setShowBgPicker] = useState(false)
  const [showTextColorPicker, setShowTextColorPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [titleValue, setTitleValue] = useState(shape.props.title)
  const bgBtnRef = useRef<HTMLButtonElement>(null)
  const textColorBtnRef = useRef<HTMLButtonElement>(null)

  // sync external title changes (only when not actively editing)
  const titleFocusedRef = useRef(false)
  useEffect(() => {
    if (!titleFocusedRef.current) setTitleValue(shape.props.title)
  }, [shape.props.title])

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Tracks the JSON string of content we last wrote locally.
  // The sync effect uses this to skip setContent for local writes (prevents cursor reset).
  const localWriteContentRef = useRef<string | null>(null)

  const tiptap = useTiptapEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    content: doc?.content ?? '',
    editable: true,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const json = editor.getJSON()
        localWriteContentRef.current = JSON.stringify(json)
        updateDoc(shape.props.richTextId, { content: json })
      }, 300)
    },
  })

  // Sync remote (Yjs/collaborator) content changes into the editor.
  // Skips setContent when the update originated locally to avoid cursor reset.
  const prevDocRef = useRef(doc)
  useEffect(() => {
    if (!tiptap || !doc) return
    if (doc === prevDocRef.current) return
    prevDocRef.current = doc
    const docStr = JSON.stringify(doc.content)
    // Same content we just wrote — skip to avoid resetting cursor
    if (localWriteContentRef.current !== null && docStr === localWriteContentRef.current) return
    tiptap.commands.setContent(doc.content ?? '', { emitUpdate: false })
    localWriteContentRef.current = docStr
  }, [doc, tiptap])

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const handleTitleChange = useCallback((v: string) => {
    setTitleValue(v)
    // Don't save empty — wait for blur to restore
    if (v.trim()) {
      tldrawEditor.updateShape({ id: shape.id, type: shape.type, props: { title: v } })
      updateDoc(shape.props.richTextId, { title: v })
    }
  }, [tldrawEditor, shape.id, shape.type, shape.props.richTextId, updateDoc])

  const handleTitleBlur = useCallback(() => {
    titleFocusedRef.current = false
    const final = titleValue.trim() || 'Document'
    setTitleValue(final)
    tldrawEditor.updateShape({ id: shape.id, type: shape.type, props: { title: final } })
    updateDoc(shape.props.richTextId, { title: final })
  }, [titleValue, tldrawEditor, shape.id, shape.type, shape.props.richTextId, updateDoc])

  const handleBgColorChange = useCallback((color: string) => {
    tldrawEditor.updateShape({ id: shape.id, type: shape.type, props: { color } })
    setShowBgPicker(false)
  }, [tldrawEditor, shape.id, shape.type])

  const handleDelete = useCallback(() => {
    deleteDoc(shape.props.richTextId)
    tldrawEditor.deleteShapes([shape.id])
  }, [deleteDoc, tldrawEditor, shape.id, shape.props.richTextId])

  const bgHex = TAILWIND_COLOR_MAP[shape.props.color] ?? '#ffffff'
  // Determine if background is dark to flip text color
  const isDarkBg = shape.props.color.includes('-800') || shape.props.color.includes('-900') || shape.props.color.includes('zinc-900')
  const textColor = isDarkBg ? '#f1f5f9' : '#111111'

  return (
    <HTMLContainer
      id={shape.id}
      style={{ width: shape.props.w, height: shape.props.h, pointerEvents: 'all', overflow: 'visible' }}
    >
      <ConnectionSelectionRing itemId={shape.props.richTextId} />
      {shape.props.richTextId && <ConnectionIndicator itemId={shape.props.richTextId} />}

      <div
        data-node-id={shape.props.richTextId}
        data-item-id={shape.props.richTextId}
        className="relative flex flex-col w-full h-full rounded-2xl shadow-md border border-white/30 overflow-hidden"
        style={{ background: bgHex, color: textColor }}
      >
        {/* ── Header (drag handle) ── */}
        <div className="flex items-center gap-1 px-3 pt-2 pb-1 border-b border-black/10 flex-shrink-0 cursor-grab active:cursor-grabbing">
          <input
            className="flex-1 text-sm font-semibold bg-transparent outline-none placeholder-gray-400 truncate cursor-text"
            style={{ color: textColor }}
            value={titleValue}
            onChange={(e) => handleTitleChange(e.target.value)}
            placeholder="Title…"
            onFocus={() => { titleFocusedRef.current = true }}
            onBlur={handleTitleBlur}
            onPointerDown={(e) => e.stopPropagation()}
          />
          {/* Background color */}
          <button
            ref={bgBtnRef}
            className="p-1 rounded hover:bg-black/10 transition-colors"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { setShowTextColorPicker(false); setShowBgPicker((v) => !v) }}
            title="Background color"
          >
            <Palette size={14} />
          </button>
          {/* Text color */}
          <button
            ref={textColorBtnRef}
            className="p-1 rounded hover:bg-black/10 transition-colors"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => { setShowBgPicker(false); setShowTextColorPicker((v) => !v) }}
            title="Text color"
          >
            <ALargeSmall size={14} />
          </button>
          {shape.props.richTextId && (
            <ConnectionLinkButton itemId={shape.props.richTextId} itemType="richText" />
          )}
          <button
            className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setShowDeleteConfirm(true)}
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>

        {/* ── Formatting toolbar ── */}
        {tiptap && (
          <div
            className="flex items-center gap-0.5 px-2 py-0.5 border-b border-black/10 flex-shrink-0 flex-wrap"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <ToolbarBtn
              active={tiptap.isActive('bold')}
              onClick={() => tiptap.chain().focus().toggleBold().run()}
              title="Bold"
            ><Bold size={12} /></ToolbarBtn>
            <ToolbarBtn
              active={tiptap.isActive('italic')}
              onClick={() => tiptap.chain().focus().toggleItalic().run()}
              title="Italic"
            ><Italic size={12} /></ToolbarBtn>
            <ToolbarBtn
              active={tiptap.isActive('underline')}
              onClick={() => tiptap.chain().focus().toggleUnderline().run()}
              title="Underline"
            ><UnderlineIcon size={12} /></ToolbarBtn>
            <div className="w-px h-3 bg-black/20 mx-0.5" />
            <ToolbarBtn
              active={tiptap.isActive('heading', { level: 1 })}
              onClick={() => tiptap.chain().focus().toggleHeading({ level: 1 }).run()}
              title="Heading 1"
            ><Heading1 size={12} /></ToolbarBtn>
            <ToolbarBtn
              active={tiptap.isActive('heading', { level: 2 })}
              onClick={() => tiptap.chain().focus().toggleHeading({ level: 2 }).run()}
              title="Heading 2"
            ><Heading2 size={12} /></ToolbarBtn>
            <div className="w-px h-3 bg-black/20 mx-0.5" />
            <ToolbarBtn
              active={tiptap.isActive('bulletList')}
              onClick={() => tiptap.chain().focus().toggleBulletList().run()}
              title="Bullet list"
            ><List size={12} /></ToolbarBtn>
            <ToolbarBtn
              active={tiptap.isActive('orderedList')}
              onClick={() => tiptap.chain().focus().toggleOrderedList().run()}
              title="Numbered list"
            ><ListOrdered size={12} /></ToolbarBtn>
          </div>
        )}

        {/* ── Editor area ── */}
        <div
          className="flex-1 overflow-y-auto px-3 py-2 text-sm leading-relaxed"
          style={{ color: textColor }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => tiptap?.commands.focus()}
        >
          <EditorContent editor={tiptap} className="h-full bords-rich-text-editor" />
        </div>
      </div>

      {/* ── Background colour picker ── */}
      {showBgPicker && (
        <ColorPicker
          currentColor={shape.props.color}
          onSelect={handleBgColorChange}
          onClose={() => setShowBgPicker(false)}
          label="Background Color"
          triggerRef={bgBtnRef}
        />
      )}

      {/* ── Text colour picker ── */}
      {showTextColorPicker && (
        <ColorPicker
          currentColor={tiptap?.getAttributes('textStyle').color ?? ''}
          onSelect={(hex) => {
            tiptap?.chain().focus().setColor(hex).run()
            setShowTextColorPicker(false)
          }}
          onClose={() => setShowTextColorPicker(false)}
          label="Text Color"
          useHex
          triggerRef={textColorBtnRef}
        />
      )}

      {/* ── Delete confirm ── */}
      {showDeleteConfirm && (
        <DeleteConfirmModal
          isOpen={showDeleteConfirm}
          onConfirm={() => { setShowDeleteConfirm(false); handleDelete() }}
          onCancel={() => setShowDeleteConfirm(false)}
          itemName="document"
        />
      )}
    </HTMLContainer>
  )
}

function ToolbarBtn({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode
  onClick: () => void
  active: boolean
  title?: string
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      className={`p-1 rounded transition-colors ${active ? 'bg-black/20' : 'hover:bg-black/10'}`}
    >
      {children}
    </button>
  )
}
