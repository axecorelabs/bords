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
import { Trash2, Palette, Play, Video, ExternalLink } from 'lucide-react'
import { ColorPicker } from '@/components/ColorPicker'
import { DeleteConfirmModal } from '@/components/DeleteConfirmModal'
import { ConnectionLinkButton, ConnectionSelectionRing } from './ConnectionLink'
import { resolveColor } from './bordsShapeTypes'
import { useThemeStore } from '@/store/themeStore'
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

/* ── Component — matches Media.tsx design with theme awareness ── */
function MediaComponent({ shape }: { shape: BordsMedia }) {
  const editor = useEditor()
  const { url, title, mediaType, color, w, h, mediaId } = shape.props
  const isDark = useThemeStore((s) => s.isDark)
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

  // YouTube embed URL
  const embedUrl = useMemo(() => {
    if (!youtubeId) return url
    return `https://www.youtube.com/embed/${youtubeId}`
  }, [youtubeId, url])

  // YouTube thumbnail
  const thumbnailUrl = useMemo(() => {
    if (!youtubeId) return null
    return `https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`
  }, [youtubeId])

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
        <ConnectionSelectionRing itemId={mediaId} />

        {/* Label badge */}
        <div
          style={{
            position: 'absolute', top: -8, left: -8,
            background: isDark ? 'rgba(39,39,42,0.85)' : 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(12px)',
            color: isDark ? '#d4d4d8' : '#3f3f46',
            fontSize: 10, padding: '4px 8px',
            borderRadius: 9999, fontWeight: 500,
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
            zIndex: 2, pointerEvents: 'none',
          }}
        >
          {mediaType === 'video' ? 'Video' : 'Image'}
        </div>

        {/* Action toolbar — frosted glass pill */}
        {showControls && (
          <div
            style={{
              position: 'absolute', top: -8, right: -8,
              background: 'rgba(255,255,255,0.85)',
              backdropFilter: 'blur(12px)',
              borderRadius: 9999,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              border: '1px solid rgba(0,0,0,0.1)',
              display: 'flex', overflow: 'hidden', zIndex: 20,
            }}
          >
            <button
              style={{
                padding: 10, border: 'none', background: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title="Open in new tab"
              onPointerDown={(e) => { e.stopPropagation(); window.open(url, '_blank') }}
            >
              <ExternalLink size={14} color="#2563eb" />
            </button>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <button
              style={{
                padding: 10, border: 'none', background: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title="Change color"
              onPointerDown={(e) => { e.stopPropagation(); setShowColorPicker(!showColorPicker) }}
            >
              <Palette size={14} color="#9333ea" />
            </button>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <div onPointerDown={(e) => e.stopPropagation()}>
              <ConnectionLinkButton itemId={mediaId} itemType="media" />
            </div>
            <div style={{ width: 1, background: '#e5e7eb' }} />
            <button
              style={{
                padding: 10, border: 'none', background: 'none',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
              title="Delete media"
              onPointerDown={(e) => { e.stopPropagation(); setShowDeleteConfirm(true) }}
            >
              <Trash2 size={14} color="#dc2626" />
            </button>
          </div>
        )}

        {/* Card body — theme-aware like Media.tsx */}
        <div
          style={{
            width: '100%', height: '100%',
            backgroundColor: bgColor || (isDark ? '#27272a' : '#ffffff'),
            borderRadius: 12,
            border: `2px solid ${isDark ? '#3f3f46' : '#d4d4d8'}`,
            overflow: 'hidden',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
            display: 'flex', flexDirection: 'column',
          }}
        >
          {/* Media content area */}
          <div
            style={{
              flex: 1, position: 'relative', overflow: 'hidden',
              background: isDark ? '#18181b' : '#f4f4f5',
              minHeight: 0,
            }}
          >
            {mediaType === 'image' ? (
              imgError ? (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  height: '100%', flexDirection: 'column', gap: 8, padding: 16,
                }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: isDark ? '#a1a1aa' : '#71717a' }}>
                    Failed to load image
                  </span>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#3b82f6', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    Open URL <ExternalLink size={12} />
                  </a>
                </div>
              ) : (
                <img
                  src={url}
                  alt={title || 'Media'}
                  onError={() => setImgError(true)}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  draggable={false}
                />
              )
            ) : youtubeId ? (
              videoActive ? (
                /* Live iframe — shown after user clicks play */
                <div style={{ position: 'relative', width: '100%', height: '100%' }}>
                  <iframe
                    src={`${embedUrl}?autoplay=1`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    style={{ width: '100%', height: '100%', border: 'none' }}
                  />
                  {/* Stop button */}
                  <button
                    onPointerDown={(e) => { e.stopPropagation(); setVideoActive(false) }}
                    style={{
                      position: 'absolute', top: 8, left: 8,
                      padding: 6, borderRadius: 8,
                      background: 'rgba(0,0,0,0.6)', border: 'none',
                      cursor: 'pointer', zIndex: 20,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <svg viewBox="0 0 24 24" fill="white" width={16} height={16}>
                      <rect x="6" y="6" width="12" height="12" rx="1" />
                    </svg>
                  </button>
                </div>
              ) : (
                /* Thumbnail + play button */
                <div
                  style={{ width: '100%', height: '100%', position: 'relative', cursor: 'pointer' }}
                  onPointerDown={(e) => { e.stopPropagation(); setVideoActive(true) }}
                >
                  {thumbnailUrl ? (
                    <img
                      src={thumbnailUrl}
                      alt={title || 'Video thumbnail'}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      draggable={false}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: isDark ? '#27272a' : '#e4e4e7',
                    }}>
                      <Video size={32} color={isDark ? '#52525b' : '#a1a1aa'} />
                    </div>
                  )}
                  {/* Play overlay */}
                  <div
                    style={{
                      position: 'absolute', inset: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(0,0,0,0.3)',
                    }}
                  >
                    <div
                      style={{
                        width: 48, height: 48, borderRadius: 9999,
                        background: 'rgba(255,255,255,0.95)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="#111" width={28} height={28} style={{ marginLeft: 2 }}>
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                height: '100%', color: isDark ? '#71717a' : '#a1a1aa', fontSize: 13,
              }}>
                Unsupported video URL
              </div>
            )}
          </div>
        </div>

        {/* Color Picker */}
        {showColorPicker && (
          <div onPointerDown={(e) => e.stopPropagation()}>
            <ColorPicker
              currentColor={color}
              onSelect={handleColorChange}
              onClose={() => setShowColorPicker(false)}
            />
          </div>
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
