'use client'
import { useState, useRef, useMemo, useEffect } from "react";
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Resizable } from 're-resizable'
import {
  Trash2,
  ExternalLink,
  Video,
  Image as ImageIcon,
  Palette,
} from "lucide-react";
import { useMediaStore, Media as MediaType } from "../store/mediaStore";
import { useThemeStore } from "../store/themeStore";
import { useDragModeStore } from "../store/dragModeStore";
import { useConnectionStore } from "../store/connectionStore";
import { ConnectionNode } from "./ConnectionNode";
import { useZIndexStore } from '../store/zIndexStore'
import { useGridStore } from '../store/gridStore'
import { DeleteConfirmModal } from './DeleteConfirmModal'
import { ColorPicker } from './ColorPicker'
import { useViewportScale } from '../hooks/useViewportScale'
import { useIsViewOnly } from '@/lib/useIsViewOnly'

export function Media({
  id,
  url,
  title,
  description,
  type,
  position,
  width,
  height,
  color,
}: MediaType) {
  const [isHovered, setIsHovered] = useState(false);
  const [showNodes, setShowNodes] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [videoActivated, setVideoActivated] = useState(false);
  const colorBtnRef = useRef<HTMLButtonElement>(null);
  const isDark = useThemeStore((state) => state.isDark);
  const { updateMedia, deleteMedia } = useMediaStore();
  const isDragEnabled = useDragModeStore((state) => state.isDragEnabled);

  // Deactivate video iframe when drag mode turns on
  useEffect(() => {
    if (isDragEnabled) setVideoActivated(false);
  }, [isDragEnabled]);

  const { selectedItems, selectItem, deselectItem, removeConnectionsByItemId } = useConnectionStore();
  const connections = useConnectionStore((state) => state.connections);
  const isVisible = useConnectionStore((state) => state.isVisible);
  const mediaRef = useRef<HTMLDivElement>(null);
  const [imageError, setImageError] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { bringToFront } = useZIndexStore()
  const zIndex = useZIndexStore((state) => state.zIndexMap[id] || 1)
  const vScale = useViewportScale()
  const isViewOnly = useIsViewOnly()

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteConfirm(true);
  };

  const handleOpenUrl = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleDoubleClick = () => {
    const isSelected = selectedItems.some((item) => item.id === id);
    if (isSelected) {
      deselectItem(id);
    } else {
      selectItem(id, "media", position);
    }
  };

  const isSelected = selectedItems.some(
    (item) => item.id === id && item.type === "media"
  );
  const isConnected = connections.some(
    (conn) => conn.fromId === id || conn.toId === id
  );

  const getConnectionSide = () => {
    const connection = connections.find(
      (conn) => conn.fromId === id || conn.toId === id
    );
    if (!connection) return null;

    const otherId =
      connection.fromId === id ? connection.toId : connection.fromId;
    const otherElement = document.querySelector(`[data-node-id="${otherId}"]`);
    if (!otherElement) return null;

    const otherRect = otherElement.getBoundingClientRect();
    const thisRect = document
      .querySelector(`[data-node-id="${id}"]`)
      ?.getBoundingClientRect();

    if (!thisRect) return null;

    return otherRect.left < thisRect.left ? "left" : "right";
  };

  // Extract YouTube video ID if it's a YouTube URL
  const getYouTubeEmbedUrl = (url: string) => {
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return match && match[2].length === 11
      ? `https://www.youtube.com/embed/${match[2]}`
      : url;
  };

  // Get YouTube thumbnail URL
  const getYouTubeThumbnail = (url: string) => {
    const regExp =
      /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    if (match && match[2].length === 11) {
      return `https://img.youtube.com/vi/${match[2]}/maxresdefault.jpg`;
    }
    return null;
  };

  const thumbnailUrl = type === "video" ? getYouTubeThumbnail(url) : null;

  const positionRef = useRef(position)
  positionRef.current = position
  const stableData = useMemo(() => ({
    type: 'media' as const, id, get position() { return positionRef.current },
  }), [id])

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `media-${id}`,
    disabled: !isDragEnabled,
    data: stableData,
  })

  const zoom = useGridStore((s) => s.zoom)
  const zoomedTransform = transform ? { ...transform, x: transform.x / (zoom * vScale), y: transform.y / (zoom * vScale) } : null

  const style = {
    transform: CSS.Translate.toString(zoomedTransform),
    position: 'absolute' as const,
    left: position.x * vScale,
    top: position.y * vScale,
    cursor: isDragEnabled ? "move" : "default",
    scrollMargin: 0,
    touchAction: "none" as const,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10000 : zIndex,
    willChange: isDragging ? 'transform' as const : 'auto' as const,
  }

  // When video is playing, don't attach drag listeners so the iframe is interactive
  const shouldAttachListeners = !(type === 'video' && videoActivated)

  return (
    <>
      <div
        ref={setNodeRef}
        {...(shouldAttachListeners ? listeners : {})}
        {...attributes}
        style={style}
        className={`item-container ${
          isSelected ? "ring-2 ring-blue-400/30" : ""
        }`}
        data-node-id={id}
        data-item-id={id}
        tabIndex={0}
        onFocus={(e) => e.preventDefault()}
        onDoubleClick={handleDoubleClick}
        onMouseDown={() => { if (!isDragging) bringToFront(id) }}
        onClick={() => { setShowNodes(true); setIsHovered(true); }}
        onBlur={() => { setShowNodes(false); setIsHovered(false); }}
        onMouseEnter={() => {
          setIsHovered(true);
          setShowNodes(true);
        }}
        onMouseLeave={() => {
          setIsHovered(false);
          setShowNodes(false);
        }}
      >
        {isConnected && isVisible && (
          <div
            className={`
              absolute top-1/2 -translate-y-1/2 w-3 h-3 
              bg-blue-500 rounded-full border-2 border-white 
              shadow-md animate-pulse connection-indicator
              ${getConnectionSide() === "left" ? "-left-1.5" : "-right-1.5"}
            `}
            data-connection-id={`${id}-indicator`}
            data-connection-side={getConnectionSide()}
          />
        )}
        <Resizable
          size={{
            width: (type === "video" ? width * 1.4 : width) * vScale,
            height: type === "image" ? (height + 8) * vScale : 'auto',
          }}
          minWidth={150 * vScale}
          minHeight={100 * vScale}
          enable={{
            right: !isViewOnly,
            bottom: !isViewOnly,
            bottomRight: !isViewOnly,
          }}
          onResizeStop={(e, direction, ref, d) => {
            if (isViewOnly) return
            const newWidth = type === "video" ? Math.round((width * 1.4 + d.width / vScale) / 1.4) : width + Math.round(d.width / vScale)
            const newHeight = type === "image" ? height + Math.round(d.height / vScale) : height
            updateMedia(id, { width: newWidth, height: newHeight })
          }}
          handleStyles={{
            right: { width: '6px', right: '-3px', cursor: 'ew-resize' },
            bottom: { height: '6px', bottom: '-3px', cursor: 'ns-resize' },
            bottomRight: { width: '12px', height: '12px', right: '-4px', bottom: '-4px', cursor: 'nwse-resize' },
          }}
          handleClasses={{
            right: 'opacity-0 hover:opacity-100 transition-opacity bg-blue-400/50 rounded-full',
            bottom: 'opacity-0 hover:opacity-100 transition-opacity bg-blue-400/50 rounded-full',
            bottomRight: 'opacity-0 hover:opacity-100 transition-opacity bg-blue-400 rounded-full',
          }}
        >
        <div
          className={`rounded-2xl border-2 overflow-hidden shadow-lg transition-all duration-200 h-full
          ${
            isSelected
              ? "border-blue-500 shadow-blue-500/50"
              : isDark
                ? "border-zinc-700 hover:border-zinc-600"
                : "border-zinc-300 hover:border-zinc-400"
          }
          ${isDark ? "bg-zinc-800" : "bg-white"}`}
          style={{
            backgroundColor: color || (isDark ? "#27272a" : "#ffffff"),
            ...(type === "image" && color && !isSelected
              ? { borderColor: color }
              : {}),
          }}
        >
          {/* Media Content */}
          <div
            className={`relative ${type === "video" ? "aspect-video" : "h-full"} ${isDark ? "bg-zinc-900" : "bg-zinc-100"}`}
          >
            {type === "image" ? (
              imageError ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center px-4">
                    <p
                      className={`text-sm font-medium mb-2 ${isDark ? "text-zinc-400" : "text-zinc-600"}`}
                    >
                      Failed to load image
                    </p>
                    <button
                      onClick={handleOpenUrl}
                      className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1 mx-auto"
                    >
                      Open URL <ExternalLink size={12} />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <img
                    src={url}
                    alt={title || "Media"}
                    className="w-full h-full object-cover pointer-events-none"
                    onError={() => setImageError(true)}
                  />
                  {/* Overlay to make entire image area draggable */}
                  <div className="absolute inset-0 cursor-move" />
                </>
              )
            ) : (
              <>
                {videoActivated ? (
                  /* Live iframe — shown after user clicks play */
                  <div className="relative w-full h-full">
                    <iframe
                      src={`${getYouTubeEmbedUrl(url)}${getYouTubeEmbedUrl(url).includes('?') ? '&' : '?'}autoplay=1`}
                      title={title || "Video"}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                    {/* Stop button — returns to thumbnail */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setVideoActivated(false); }}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="absolute top-2 left-2 z-20 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white transition-colors"
                      title="Stop video"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                        <rect x="6" y="6" width="12" height="12" rx="1" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  /* Thumbnail + play button — always visible */
                  <div className="relative w-full h-full group/play">
                    {thumbnailUrl ? (
                      <img
                        src={thumbnailUrl}
                        alt={title || "Video thumbnail"}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className={`w-full h-full flex items-center justify-center ${isDark ? 'bg-zinc-800' : 'bg-zinc-200'}`}>
                        <Video size={32} className={isDark ? 'text-zinc-600' : 'text-zinc-400'} />
                      </div>
                    )}
                    {/* Play button overlay — always shown so user knows it's a video */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30 group-hover/play:bg-black/40 transition-colors">
                      <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setVideoActivated(true);
                        }}
                        className="w-12 h-12 rounded-full bg-white/95 hover:bg-white flex items-center justify-center shadow-[0_2px_12px_rgba(0,0,0,0.3)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:scale-110 active:scale-95 transition-all cursor-pointer backdrop-blur-sm"
                      >
                        <svg viewBox="0 0 24 24" fill="#111" className="w-7 h-7 ml-0.5">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
                {/* Hidden thumbnail for export - behind everything, only for canvas capture */}
                {thumbnailUrl && (
                  <img
                    src={thumbnailUrl}
                    alt={title || "Video thumbnail"}
                    className="absolute inset-0 w-full h-full object-cover -z-10 pointer-events-none"
                    crossOrigin="anonymous"
                    data-export-thumbnail="true"
                  />
                )}
              </>
            )}
          </div>

          {/* Title & Description - Only for videos */}
          {type === "video" && (
            <div
              className={`p-4 border-t ${isDark ? "border-zinc-700" : "border-zinc-200"}`}
            >
              {title && (
                <h3
                  className={`font-semibold mb-1 line-clamp-2 ${isDark ? "text-white" : "text-zinc-900"}`}
                >
                  {title}
                </h3>
              )}
              {description && (
                <p
                  className={`text-sm ${isDark ? "text-zinc-400" : "text-zinc-600"}`}
                >
                  {description}
                </p>
              )}
              {!title && !description && (
                <p
                  className={`text-sm ${isDark ? "text-zinc-500" : "text-zinc-400"}`}
                >
                  <Video size={14} />
                </p>
              )}
            </div>
          )}

          {/* Action Buttons */}
          {!isViewOnly && (
          <div
            className={`absolute top-2 right-2 flex gap-2 transition-opacity duration-200 z-20
            ${isHovered ? "opacity-100" : "opacity-0"}`}
          >
            <button
              ref={colorBtnRef}
              onClick={(e) => {
                e.stopPropagation();
                setShowColorPicker(!showColorPicker);
              }}
              className="p-2 rounded-lg bg-purple-500 hover:bg-purple-600 text-white shadow-lg transition-colors"
              title="Change media color"
            >
              <Palette size={16} />
            </button>
            <button
              onClick={handleDelete}
              className="p-2 rounded-lg bg-red-500 hover:bg-red-600 text-white shadow-lg transition-colors"
              title="Delete media"
            >
              <Trash2 size={16} />
            </button>
          </div>
          )}
          {/* Connection Nodes */}
          <ConnectionNode
            id={id}
            type="media"
            side="left"
            position={position}
            isVisible={showNodes}
          />
          <ConnectionNode
            id={id}
            type="media"
            side="right"
            position={position}
            isVisible={showNodes}
          />

          {/* Color Picker */}
          {showColorPicker && (
            <ColorPicker
              currentColor={color || '#FFFFFF'}
              onSelect={(c) => updateMedia(id, { color: c })}
              onClose={() => setShowColorPicker(false)}
              label="Background Color"
              useHex
              triggerRef={colorBtnRef}
            />
          )}
        </div>
        </Resizable>
      </div>

      <DeleteConfirmModal
        isOpen={showDeleteConfirm}
        onConfirm={() => {
          removeConnectionsByItemId(id)
          deleteMedia(id)
          useZIndexStore.getState().removeItem(id)
          setShowDeleteConfirm(false)
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        itemName={title || 'Media'}
        itemType="media"
      />
    </>
  );
}
