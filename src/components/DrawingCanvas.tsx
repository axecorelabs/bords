'use client'

import { useEffect, useRef, useState } from 'react'
import { useDrawingStore } from '@/store/drawingStore'
import { useThemeStore } from '@/store/themeStore'
import { useBoardStore } from '@/store/boardStore'
import { useGridStore } from '@/store/gridStore'
import { Point, DrawingPath, Drawing } from '@/types/drawing'
import { usePresentationStore } from '@/store/presentationStore'
import { Eraser, Pencil, Palette, X, Undo2, Redo2, Pause, Play } from 'lucide-react'

// ── Constants ──────────────────────────────────────────
const COLORS = [
  '#000000', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e', '#14b8a6', '#84cc16',
  '#ffffff', '#6b7280', '#92400e', '#6366f1', '#a855f7', '#d946ef',
]

const STROKE_PRESETS = [1, 2, 4, 6, 8, 12, 16, 24]

// ── Path Smoothing (Quadratic Bezier through midpoints) ──
function buildSmoothPath(points: Point[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) {
    const p = points[0]
    return `M ${p.x} ${p.y} L ${p.x + 0.1} ${p.y}`
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`
  }

  let d = `M ${points[0].x} ${points[0].y}`
  const m0x = (points[0].x + points[1].x) / 2
  const m0y = (points[0].y + points[1].y) / 2
  d += ` L ${m0x} ${m0y}`

  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2
    const my = (points[i].y + points[i + 1].y) / 2
    d += ` Q ${points[i].x} ${points[i].y} ${mx} ${my}`
  }

  const last = points[points.length - 1]
  d += ` L ${last.x} ${last.y}`
  return d
}

// ── Point Simplification (Ramer-Douglas-Peucker) ───────
function perpDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

function simplifyPoints(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return [...points]
  let maxDist = 0
  let maxIdx = 0
  const first = points[0]
  const last = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], first, last)
    if (d > maxDist) {
      maxDist = d
      maxIdx = i
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPoints(points.slice(0, maxIdx + 1), epsilon)
    const right = simplifyPoints(points.slice(maxIdx), epsilon)
    return [...left.slice(0, -1), ...right]
  }
  return [first, last]
}

// ── Geometry: point-to-segment distance (for eraser) ───
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// ── SVG Layer (stays inside zoomed items div) ─────────
export function DrawingSVGLayer() {
  const drawings = useDrawingStore((s) => s.drawings)
  const currentBoard = useBoardStore((s) =>
    s.boards.find((b) => b.id === s.currentBoardId),
  )
  const boardDrawings = drawings.filter((d) =>
    currentBoard?.drawings?.includes(d.id),
  )

  if (boardDrawings.length === 0) return null

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ overflow: 'visible', zIndex: 5 }}
    >
      {boardDrawings.map((drawing) =>
        (drawing.paths || []).map((path) => (
          <path
            key={path.id}
            d={buildSmoothPath(path.points || [])}
            stroke={path.color}
            strokeWidth={path.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={0.95}
          />
        )),
      )}
    </svg>
  )
}

// ════════════════════════════════════════════════════════
export function DrawingCanvas() {
  // ── Refs (no re-renders during drawing) ───────────────
  const previewCanvasRef = useRef<HTMLCanvasElement>(null)
  const currentPointsRef = useRef<Point[]>([])
  const isPointerDownRef = useRef(false)
  const activePointerRef = useRef<number | null>(null)
  const scrollOffsetRef = useRef({ x: 0, y: 0 })
  const canvasRectRef = useRef({ left: 0, top: 0 })
  const lastScreenPosRef = useRef({ x: 0, y: 0 })

  // ── State ─────────────────────────────────────────────
  const [eraserScreenPos, setEraserScreenPos] = useState<{ x: number; y: number } | null>(null)
  const [showControls, setShowControls] = useState(true)
  const [scrollThumb, setScrollThumb] = useState({ top: 0, height: 0, visible: false })
  const scrollbarDragRef = useRef<{ startY: number; startScrollTop: number } | null>(null)

  // ── Store ─────────────────────────────────────────────
  const {
    isDrawing,
    isErasing,
    isPaused,
    drawings,
    currentColor,
    currentStrokeWidth,
    eraserWidth,
    toggleDrawing,
    toggleEraser,
    togglePause,
    setColor,
    setStrokeWidth,
    setEraserWidth,
    addDrawing,
    deleteDrawing,
    undoLastDrawing,
    redoLastDrawing,
    undoneDrawings,
  } = useDrawingStore()

  const isDark = useThemeStore((s) => s.isDark)
  const currentBoardId = useBoardStore((s) => s.currentBoardId)
  const currentBoard = useBoardStore((s) =>
    s.boards.find((b) => b.id === s.currentBoardId),
  )
  const addItemToBoard = useBoardStore((s) => s.addItemToBoard)
  const isPresentationMode = usePresentationStore((s) => s.isPresentationMode)

  // ── Derived ───────────────────────────────────────────
  const boardDrawings = drawings.filter((d) =>
    currentBoard?.drawings?.includes(d.id),
  )

  // ── Scroll / coordinate helpers ───────────────────────
  const captureScroll = () => {
    const el = document.querySelector('[data-board-canvas]') as HTMLElement
    scrollOffsetRef.current = {
      x: el?.scrollLeft || 0,
      y: el?.scrollTop || 0,
    }
    const rect = el?.getBoundingClientRect()
    canvasRectRef.current = {
      left: rect?.left ?? 0,
      top: rect?.top ?? 0,
    }
  }

  const screenToContent = (cx: number, cy: number): Point => {
    const zoom = useGridStore.getState().zoom
    return {
      x: ((cx - canvasRectRef.current.left) + scrollOffsetRef.current.x) / zoom,
      y: ((cy - canvasRectRef.current.top) + scrollOffsetRef.current.y) / zoom,
    }
  }

  // ── Canvas setup (high-DPI) ───────────────────────────
  useEffect(() => {
    const canvas = previewCanvasRef.current
    if (!canvas) return
    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = window.innerWidth + 'px'
      canvas.style.height = window.innerHeight + 'px'
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.scale(dpr, dpr)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  // ── Keyboard shortcuts (Ctrl+Z / Ctrl+Shift+Z) ───────
  useEffect(() => {
    if (!isDrawing) return
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redoLastDrawing()
        else undoLastDrawing()
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [isDrawing, undoLastDrawing, redoLastDrawing])

  // ── Clear eraser cursor when leaving draw mode ────────
  useEffect(() => {
    if (!isDrawing) setEraserScreenPos(null)
  }, [isDrawing])

  // ── Prevent iOS Safari text selection on the drawing overlay ───
  const inputOverlayRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = inputOverlayRef.current
    if (!el || !isDrawing) return
    const prevent = (e: TouchEvent) => e.preventDefault()
    // Must be non-passive to allow preventDefault on touch
    el.addEventListener('touchstart', prevent, { passive: false })
    el.addEventListener('touchmove', prevent, { passive: false })
    return () => {
      el.removeEventListener('touchstart', prevent)
      el.removeEventListener('touchmove', prevent)
    }
  }, [isDrawing])

  // ── Draw-mode scrollbar sync ──────────────────────────
  useEffect(() => {
    if (!isDrawing) {
      setScrollThumb(p => ({ ...p, visible: false }))
      return
    }
    const el = document.querySelector('[data-board-canvas]') as HTMLElement
    if (!el) return

    const sync = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      if (scrollHeight <= clientHeight) {
        setScrollThumb({ top: 0, height: 0, visible: false })
        return
      }
      const trackH = clientHeight - 16 // 8px top + 8px bottom padding
      const thumbH = Math.max(30, (clientHeight / scrollHeight) * trackH)
      const maxScroll = scrollHeight - clientHeight
      const thumbTop = 8 + ((scrollTop / maxScroll) * (trackH - thumbH))
      setScrollThumb({ top: thumbTop, height: thumbH, visible: true })
    }

    sync()
    el.addEventListener('scroll', sync, { passive: true })
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', sync)
      ro.disconnect()
    }
  }, [isDrawing])

  const handleScrollbarPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    const el = document.querySelector('[data-board-canvas]') as HTMLElement
    if (!el) return
    scrollbarDragRef.current = { startY: e.clientY, startScrollTop: el.scrollTop }
  }

  const handleScrollbarPointerMove = (e: React.PointerEvent) => {
    if (!scrollbarDragRef.current) return
    e.stopPropagation()
    const el = document.querySelector('[data-board-canvas]') as HTMLElement
    if (!el) return
    const { scrollHeight, clientHeight } = el
    const trackH = clientHeight - 16
    const thumbH = Math.max(30, (clientHeight / scrollHeight) * trackH)
    const maxScroll = scrollHeight - clientHeight
    const dy = e.clientY - scrollbarDragRef.current.startY
    const scrollDelta = (dy / (trackH - thumbH)) * maxScroll
    el.scrollTop = Math.max(0, Math.min(maxScroll, scrollbarDragRef.current.startScrollTop + scrollDelta))
  }

  const handleScrollbarPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation()
    scrollbarDragRef.current = null
  }

  // ── Preview canvas drawing helpers ────────────────────
  const drawPreviewSegment = (
    fromX: number, fromY: number,
    toX: number, toY: number,
    color: string, width: number,
  ) => {
    const canvas = previewCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    ctx.moveTo(fromX, fromY)
    ctx.lineTo(toX, toY)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
  }

  const drawPreviewDot = (x: number, y: number, color: string, width: number) => {
    const canvas = previewCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    ctx.arc(x, y, width / 2, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
  }

  const clearPreview = () => {
    const canvas = previewCanvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    const dpr = window.devicePixelRatio || 1
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
  }

  // ── Stroke eraser ─────────────────────────────────────
  const eraseAtPoint = (contentPt: Point) => {
    const zoom = useGridStore.getState().zoom
    const radius = eraserWidth / (2 * zoom)
    const state = useDrawingStore.getState()
    const bState = useBoardStore.getState()
    const board = bState.boards.find((b) => b.id === bState.currentBoardId)
    const boardIds = board?.drawings || []
    const bDrawings = state.drawings.filter((d) => boardIds.includes(d.id))

    const toErase: string[] = []
    for (const drawing of bDrawings) {
      let hit = false
      for (const path of (drawing.paths || [])) {
        if (hit) break
        const pts = path.points || []
        if (pts.length === 1) {
          if (Math.hypot(contentPt.x - pts[0].x, contentPt.y - pts[0].y) < radius + path.strokeWidth / 2) {
            toErase.push(drawing.id)
            hit = true
          }
          continue
        }
        for (let i = 0; i < pts.length - 1; i++) {
          if (distToSegment(contentPt, pts[i], pts[i + 1]) < radius + path.strokeWidth / 2) {
            toErase.push(drawing.id)
            hit = true
            break
          }
        }
      }
    }

    if (toErase.length > 0) {
      toErase.forEach((id) => useDrawingStore.getState().deleteDrawing(id))
    }
  }

  // ── Pointer handlers (unified: mouse + touch + stylus) ─
  const handlePointerDown = (e: React.PointerEvent) => {
    if (!isDrawing) return
    // Palm rejection: only track primary pointer
    if (e.pointerType === 'touch' && !e.isPrimary) return
    if (activePointerRef.current !== null) return

    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    activePointerRef.current = e.pointerId
    isPointerDownRef.current = true
    captureScroll()

    if (isErasing) {
      setEraserScreenPos({ x: e.clientX, y: e.clientY })
      eraseAtPoint(screenToContent(e.clientX, e.clientY))
    } else {
      const pt = screenToContent(e.clientX, e.clientY)
      pt.pressure = e.pressure || 0.5
      currentPointsRef.current = [pt]
      lastScreenPosRef.current = { x: e.clientX, y: e.clientY }
      // Draw initial dot so user sees immediate visual feedback
      drawPreviewDot(e.clientX, e.clientY, currentColor, currentStrokeWidth)
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDrawing) return
    e.preventDefault()

    if (isErasing) {
      setEraserScreenPos({ x: e.clientX, y: e.clientY })
    }

    if (e.pointerId !== activePointerRef.current) return
    if (!isPointerDownRef.current) return

    if (isErasing) {
      eraseAtPoint(screenToContent(e.clientX, e.clientY))
      return
    }

    // Drawing: accumulate point + draw live preview segment
    const contentPt = screenToContent(e.clientX, e.clientY)
    contentPt.pressure = e.pressure || 0.5
    const points = currentPointsRef.current
    const prev = points[points.length - 1]

    if (prev) {
      const dx = contentPt.x - prev.x
      const dy = contentPt.y - prev.y
      if (dx * dx + dy * dy < 2.25) return

      const last = lastScreenPosRef.current
      drawPreviewSegment(last.x, last.y, e.clientX, e.clientY, currentColor, currentStrokeWidth)
    }

    currentPointsRef.current.push(contentPt)
    lastScreenPosRef.current = { x: e.clientX, y: e.clientY }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (e.pointerId !== activePointerRef.current) return
    activePointerRef.current = null
    isPointerDownRef.current = false

    if (isErasing) return

    const rawPoints = currentPointsRef.current
    if (rawPoints.length === 0) {
      clearPreview()
      return
    }

    // Stroke width in content space = screen width / zoom
    const zoom = useGridStore.getState().zoom
    const contentStrokeWidth = currentStrokeWidth / zoom

    // Single tap = dot
    if (rawPoints.length === 1) {
      const drawingId = Date.now().toString()
      const drawing: Drawing = {
        id: drawingId,
        paths: [{
          id: drawingId + '-p',
          points: rawPoints,
          color: currentColor,
          strokeWidth: contentStrokeWidth,
          timestamp: Date.now(),
        }],
        position: { x: 0, y: 0 },
      }
      addDrawing(drawing)
      if (currentBoardId) addItemToBoard(currentBoardId, 'drawings', drawingId)
      currentPointsRef.current = []
      clearPreview()
      return
    }

    // Simplify + commit to store
    const simplified = simplifyPoints(rawPoints, 1.5)
    const drawingId = Date.now().toString()
    const drawing: Drawing = {
      id: drawingId,
      paths: [{
        id: drawingId + '-p',
        points: simplified,
        color: currentColor,
        strokeWidth: contentStrokeWidth,
        timestamp: Date.now(),
      }],
      position: { x: 0, y: 0 },
    }

    addDrawing(drawing)
    if (currentBoardId) addItemToBoard(currentBoardId, 'drawings', drawingId)

    currentPointsRef.current = []
    clearPreview()
  }

  const handlePointerCancel = () => {
    activePointerRef.current = null
    isPointerDownRef.current = false
    currentPointsRef.current = []
    clearPreview()
  }

  const clearAllDrawings = () => {
    boardDrawings.forEach((d) => deleteDrawing(d.id))
  }

  // ════════════════════════════ RENDER ═══════════════════
  return (
    <>
      {/* ── Input Overlay (fixed, captures all pointer events) ── */}
      <div
        ref={inputOverlayRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className="select-none"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: isDrawing && !isPaused ? 9990 : -1,
          touchAction: 'none',
          WebkitUserSelect: 'none',
          WebkitTouchCallout: 'none',
          cursor: isDrawing && !isPaused ? (isErasing ? 'none' : 'crosshair') : 'auto',
          pointerEvents: isDrawing && !isPaused ? 'auto' : 'none',
        } as React.CSSProperties}
      />

      {/* ── Preview Canvas (fixed, shows live stroke as you draw) ── */}
      <canvas
        ref={previewCanvasRef}
        className="fixed inset-0 pointer-events-none"
        style={{
          zIndex: isDrawing && !isErasing ? 9991 : -1,
          opacity: isDrawing && !isErasing ? 1 : 0,
        }}
      />

      {/* ── Eraser Cursor (visual circle at pointer position) ── */}
      {isDrawing && isErasing && eraserScreenPos && (
        <div
          className="fixed pointer-events-none rounded-full border-2 border-red-400/80 bg-red-200/20"
          style={{
            zIndex: 9992,
            left: eraserScreenPos.x - eraserWidth / 2,
            top: eraserScreenPos.y - eraserWidth / 2,
            width: eraserWidth,
            height: eraserWidth,
            transition: 'width 0.1s, height 0.1s',
          }}
        />
      )}

      {/* ── Draw-mode Scrollbar (slim, left side) ── */}
      {isDrawing && scrollThumb.visible && (
        <div
          className="fixed left-1 top-0 bottom-0 pointer-events-auto"
          style={{ zIndex: 9993, width: 10 }}
          onPointerDown={(e) => {
            // Click on track = jump to position
            e.stopPropagation()
            e.preventDefault()
            const el = document.querySelector('[data-board-canvas]') as HTMLElement
            if (!el) return
            const { scrollHeight, clientHeight } = el
            const fraction = (e.clientY - 8) / (clientHeight - 16)
            el.scrollTop = fraction * (scrollHeight - clientHeight)
          }}
        >
          {/* Track */}
          <div className="absolute inset-x-0 top-2 bottom-2 rounded-full bg-black/5 dark:bg-white/5" />
          {/* Thumb */}
          <div
            onPointerDown={handleScrollbarPointerDown}
            onPointerMove={handleScrollbarPointerMove}
            onPointerUp={handleScrollbarPointerUp}
            onPointerCancel={handleScrollbarPointerUp}
            className="absolute rounded-full bg-black/25 dark:bg-white/25 hover:bg-black/40 dark:hover:bg-white/40 active:bg-black/50 dark:active:bg-white/50 transition-colors cursor-grab active:cursor-grabbing"
            style={{
              left: 1,
              right: 1,
              top: scrollThumb.top,
              height: scrollThumb.height,
            }}
          />
        </div>
      )}

      {/* ══════════ Controls Panel ══════════ */}
      {isDrawing && showControls && (
        <div
          className={`fixed top-1/2 -translate-y-1/2 pointer-events-auto ${isPresentationMode ? 'right-6' : 'right-24'}`}
          style={{ zIndex: 9999 }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className={`p-3.5 rounded-2xl backdrop-blur-xl border shadow-lg ${
              isDark
                ? 'bg-zinc-800/95 border-zinc-700/50'
                : 'bg-white/95 border-zinc-200/50'
            } space-y-3 w-[220px]`}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <span
                className={`text-xs font-semibold tracking-wide uppercase ${
                  isDark ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                {isErasing ? 'Eraser' : 'Drawing'}
              </span>
              <button
                onClick={() => setShowControls(false)}
                className={`p-1 rounded-lg transition-colors ${
                  isDark ? 'hover:bg-zinc-700' : 'hover:bg-zinc-100'
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Pen / Eraser Toggle */}
            <div
              className={`flex gap-0.5 p-0.5 rounded-xl ${
                isDark ? 'bg-zinc-700/60' : 'bg-zinc-100'
              }`}
            >
              <button
                onClick={() => { if (isErasing) toggleEraser() }}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  !isErasing
                    ? isDark
                      ? 'bg-zinc-600 shadow-sm text-blue-400'
                      : 'bg-white shadow-sm text-blue-600'
                    : isDark
                      ? 'text-gray-500 hover:text-gray-300'
                      : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <Pencil className="w-3 h-3" />
                Pen
              </button>
              <button
                onClick={() => { if (!isErasing) toggleEraser() }}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isErasing
                    ? isDark
                      ? 'bg-zinc-600 shadow-sm text-red-400'
                      : 'bg-white shadow-sm text-red-500'
                    : isDark
                      ? 'text-gray-500 hover:text-gray-300'
                      : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <Eraser className="w-3 h-3" />
                Eraser
              </button>
            </div>

            {isErasing ? (
              /* Eraser Size */
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Size
                  </label>
                  <span className={`text-[10px] font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {eraserWidth}px
                  </span>
                </div>
                <input
                  type="range"
                  min={8}
                  max={80}
                  value={eraserWidth}
                  onChange={(e) => setEraserWidth(Number(e.target.value))}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-red-500"
                />
                <div className={`flex items-center justify-center py-4 rounded-xl ${isDark ? 'bg-zinc-900/60' : 'bg-zinc-50'}`}>
                  <div
                    className="rounded-full border-2 border-red-400/60 transition-all"
                    style={{ width: Math.min(eraserWidth, 60), height: Math.min(eraserWidth, 60) }}
                  />
                </div>
              </div>
            ) : (
              <>
                {/* Color Grid */}
                <div className="space-y-1.5">
                  <label className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                    Color
                  </label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {COLORS.map((color) => (
                      <button
                        key={color}
                        onClick={() => setColor(color)}
                        className={`w-7 h-7 rounded-lg transition-all duration-150 ${
                          currentColor === color
                            ? 'ring-2 ring-blue-500 ring-offset-1 scale-110'
                            : 'hover:scale-105'
                        }`}
                        style={{
                          backgroundColor: color,
                          border: color === '#ffffff' ? '1px solid #e5e7eb' : 'none',
                        }}
                      />
                    ))}
                  </div>
                </div>

                {/* Stroke Width */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      Size
                    </label>
                    <span className={`text-[10px] font-mono ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                      {currentStrokeWidth}px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={30}
                    value={currentStrokeWidth}
                    onChange={(e) => setStrokeWidth(Number(e.target.value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="flex gap-1 justify-center">
                    {STROKE_PRESETS.map((w) => (
                      <button
                        key={w}
                        onClick={() => setStrokeWidth(w)}
                        className={`flex items-center justify-center w-7 h-7 rounded-lg transition-all ${
                          currentStrokeWidth === w
                            ? isDark
                              ? 'bg-blue-500/20 ring-1 ring-blue-400'
                              : 'bg-blue-50 ring-1 ring-blue-400'
                            : isDark
                              ? 'hover:bg-zinc-700'
                              : 'hover:bg-zinc-100'
                        }`}
                      >
                        <div
                          className="rounded-full"
                          style={{
                            width: Math.max(w * 1.2, 3),
                            height: Math.max(w * 1.2, 3),
                            backgroundColor: currentColor,
                            border: currentColor === '#ffffff' ? '1px solid #d1d5db' : 'none',
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Actions */}
            <div className={`space-y-1.5 pt-2.5 border-t ${isDark ? 'border-zinc-700/60' : 'border-zinc-200/80'}`}>
              <div className="flex gap-1.5">
                <button
                  onClick={() => undoLastDrawing()}
                  disabled={boardDrawings.length === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-all text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Undo (Ctrl+Z)"
                >
                  <Undo2 className="w-3.5 h-3.5" />
                  Undo
                </button>
                <button
                  onClick={() => redoLastDrawing()}
                  disabled={undoneDrawings.length === 0}
                  className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-all text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Redo (Ctrl+Shift+Z)"
                >
                  <Redo2 className="w-3.5 h-3.5" />
                  Redo
                </button>
              </div>
              <button
                onClick={clearAllDrawings}
                disabled={boardDrawings.length === 0}
                className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors text-xs font-medium disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Eraser className="w-3.5 h-3.5" />
                Clear All
              </button>
              <button
                onClick={togglePause}
                className={`w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg transition-colors text-xs font-medium ${
                  isPaused
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : isDark
                      ? 'bg-zinc-700 hover:bg-zinc-600 text-gray-300'
                      : 'bg-zinc-200 hover:bg-zinc-300 text-gray-700'
                }`}
              >
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                {isPaused ? 'Resume Drawing' : 'Pause Drawing'}
              </button>
              <button
                onClick={toggleDrawing}
                className={`w-full px-2 py-1.5 rounded-lg transition-colors text-xs font-medium ${
                  isDark
                    ? 'bg-zinc-700 hover:bg-zinc-600 text-gray-300'
                    : 'bg-zinc-200 hover:bg-zinc-300 text-gray-700'
                }`}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Collapsed Controls Button */}
      {isDrawing && !showControls && (
        <button
          onClick={() => setShowControls(true)}
          onPointerDown={(e) => e.stopPropagation()}
          className={`fixed top-1/2 -translate-y-1/2 p-3 rounded-xl shadow-lg border transition-all hover:scale-105 pointer-events-auto ${
            isPresentationMode ? 'right-6' : 'right-24'
          } ${
            isDark
              ? 'bg-zinc-800/95 border-zinc-700/50'
              : 'bg-white/95 border-zinc-200/50'
          }`}
          style={{ zIndex: 9999 }}
        >
          <Palette className="w-5 h-5" />
        </button>
      )}

      {/* Subtle draw trigger for presentation mode */}
      {isPresentationMode && !isDrawing && (
        <button
          onClick={toggleDrawing}
          onPointerDown={(e) => e.stopPropagation()}
          className="fixed bottom-4 right-4 p-2 rounded-full opacity-0 hover:opacity-100 focus:opacity-100 transition-opacity duration-300 pointer-events-auto bg-black/10 hover:bg-black/20 backdrop-blur-sm"
          style={{ zIndex: 9999 }}
          title="Draw (hover to reveal)"
        >
          <Pencil className="w-4 h-4 text-gray-500" />
        </button>
      )}
    </>
  )
}
