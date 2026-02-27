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
} from 'tldraw'
import { useState, useCallback, useMemo } from 'react'
import { Trash2, Palette, GripVertical, Play, Square, ExternalLink } from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal'
import { ConnectionLinkButton, ConnectionSelectionRing, ConnectionIndicator } from './ConnectionLink'
import { resolveColor } from './bordsShapeTypes'
import type { BordsMedia } from './bordsShapeTypes'

/* ── YouTube ID extraction ── */
function extractYouTubeId(url: string): string | null {
  const match = url.match(/^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/)
  return match && match[2].length === 11 ? match[2] : null
}

/* ── Shape Util ── */
export class BordsMediaUtil extends ShapeUtil<BordsMedia> {
  static override type = 'bords-media' as const

  static override props: RecordProps<BordsMedia> = {
    w: T.number,
    h: T.number,
    url: T.string,
    title: T.string,
    mediaType: T.literalEnum('image', 'video'),
    color: T.string,
    mediaId: T.string,
  }

  getDefaultProps(): BordsMedia['props'] {
    return {
      w: 320,
      h: 240,
      url: '',
      title: 'Media',
      mediaType: 'image',
      color: 'bg-white/90',
      mediaId: '',
    }
  }

  getGeometry(shape: BordsMedia) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    })
  }

  component(shape: BordsMedia) {
    return <MediaComponent shape={shape} />
  }

  indicator(shape: BordsMedia) {
    return (
      <rect rx={12} ry={12} width={shape.props.w} height={shape.props.h} fill="none" />
    )
  }

  override canResize() { return true }

  override onResize(shape: BordsMedia, info: TLResizeInfo<any>) {
    return resizeBox(shape as any, info)
  }
}

/* ── Component ── */
function MediaComponent({ shape }: { shape: BordsMedia }) {
  const editor = useEditor()
  const { url, title, mediaType, color, w, h, mediaId } = shape.props
  const [showControls, setShowControls] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [videoActive, setVideoActive] = useState(false)
  const [imgError, setImgError] = useState(false)

  const youtubeId = useMemo(() => mediaType === 'video' ? extractYouTubeId(url) : null, [url, mediaType])
  const bgColor = resolveColor(color)

  const handleColorChange = useCallback((newColor: string) => {
    editor.updateShape({
      id: shape.id,
      type: 'bords-media',
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
      style={{ width: w, height: h, pointerEvents: 'all' }}
    >
      <div
        data-node-id={mediaId}
        data-item-id={mediaId}
        onMouseEnter={() => setShowControls(true)}
        onMouseLeave={() => setShowControls(false)}
        style={{ width: '100%', height: '100%', position: 'relative' }}
      >
        {/* Connection indicator — dynamic side */}
        <ConnectionIndicator itemId={mediaId} />
        <ConnectionSelectionRing itemId={mediaId} />
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
          {mediaType === 'video' ? 'Video' : 'Image'}
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
              title="Open in new tab"
              onPointerDown={(e) => { e.stopPropagation(); window.open(url, '_blank') }}
            >
              <ExternalLink size={14} color="#3b82f6" />
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
            <ConnectionLinkButton itemId={mediaId} itemType="media" />
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <button
              style={{ padding: 10, border: 'none', background: 'none', cursor: 'pointer' }}
              title="Delete media"
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
            backgroundColor: bgColor, borderRadius: 12,
            border: '2px solid rgba(0,0,0,0.1)',
            overflow: 'hidden',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
            display: 'flex', flexDirection: 'column',
          }}
        >
          {/* Media content */}
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {mediaType === 'image' ? (
              imgError ? (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%', color: '#9ca3af', fontSize: 13,
                  flexDirection: 'column', gap: 8,
                }}>
                  <span>Failed to load image</span>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#3b82f6', fontSize: 12 }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    Open URL
                  </a>
                </div>
              ) : (
                <img
                  src={url}
                  alt={title || 'Media'}
                  onError={() => setImgError(true)}
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover',
                  }}
                  draggable={false}
                />
              )
            ) : youtubeId ? (
              videoActive ? (
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                  <iframe
                    src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{ width: '100%', height: '100%', border: 'none' }}
                  />
                  <button
                    onPointerDown={(e) => { e.stopPropagation(); setVideoActive(false) }}
                    style={{
                      position: 'absolute', top: 8, right: 8,
                      padding: 6, borderRadius: 8,
                      background: 'rgba(0,0,0,0.6)', border: 'none',
                      cursor: 'pointer', zIndex: 5,
                    }}
                  >
                    <Square size={14} color="white" />
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    width: '100%', height: '100%', position: 'relative',
                    cursor: 'pointer',
                  }}
                  onPointerDown={(e) => { e.stopPropagation(); setVideoActive(true) }}
                >
                  <img
                    src={`https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`}
                    alt={title || 'Video'}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    draggable={false}
                  />
                  <div
                    style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(0,0,0,0.3)',
                    }}
                  >
                    <div
                      style={{
                        width: 56, height: 56, borderRadius: 9999,
                        background: 'rgba(255,255,255,0.9)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                      }}
                    >
                      <Play size={24} color="#1f2937" fill="#1f2937" style={{ marginLeft: 3 }} />
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100%', color: '#9ca3af', fontSize: 13,
              }}>
                Unsupported video URL
              </div>
            )}
          </div>

          {/* Title bar */}
          {title && (
            <div
              style={{
                padding: '8px 12px',
                borderTop: '1px solid rgba(0,0,0,0.08)',
                fontSize: 12, fontWeight: 600, color: '#1f2937',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {title}
            </div>
          )}
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
        itemName={title || 'this media'}
        itemType="media"
      />
    </HTMLContainer>
  )
}
