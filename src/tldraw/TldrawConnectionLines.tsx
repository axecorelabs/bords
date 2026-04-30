'use client'
import { useEffect, useRef } from 'react'
import { useEditor, useValue } from 'tldraw'
import { useConnectionStore } from '@/store/connectionStore'
import { useBoardStore } from '@/store/boardStore'

/**
 * TldrawConnectionLines
 * 
 * Renders connection lines directly on the tldraw canvas using the
 * `OnTheCanvas` component slot. This means:
 * - Lines are in tldraw's page coordinate space → automatically follow pan/zoom
 * - Lines render BEFORE shapes in DOM order → naturally behind shapes
 * - No need for fixed overlays or getBoundingClientRect()
 * 
 * Uses tldraw's shape positions from the editor store directly.
 */
export function TldrawConnectionLines() {
  const editor = useEditor()
  const connections = useConnectionStore((s) => s.connections)
  const isVisible = useConnectionStore((s) => s.isVisible)
  const currentBoardId = useBoardStore((s) => s.currentBoardId ?? '')

  const boardConnections = connections.filter((c) => c.boardId === currentBoardId)

  if (!isVisible || boardConnections.length === 0) return null

  return (
    <>
      <style>{`
        .tldraw-connection-line {
          filter: drop-shadow(0 0 4px rgba(0,0,0,0.1));
        }
      `}</style>
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: 1,
          height: 1,
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: -1,
        }}
      >
        {boardConnections.map((conn) => (
          <TldrawConnectionPath
            key={conn.id}
            fromId={conn.fromId}
            toId={conn.toId}
            color={conn.color}
          />
        ))}
      </svg>
    </>
  )
}

/**
 * Individual connection path — reads shape positions from tldraw editor
 * and draws a Bézier curve between them in page coordinates.
 */
function TldrawConnectionPath({
  fromId,
  toId,
  color,
}: {
  fromId: string
  toId: string
  color: string
}) {
  const editor = useEditor()
  const pathRef = useRef<SVGPathElement>(null)

  // Use useValue to reactively track all shapes (re-renders when any shape changes)
  const shapes = useValue('shapes', () => editor.getCurrentPageShapes(), [editor])

  useEffect(() => {
    const el = pathRef.current
    if (!el) return

    // Find the tldraw shapes that contain these item IDs
    let fromShape: { x: number; y: number; w: number; h: number } | null = null
    let toShape: { x: number; y: number; w: number; h: number } | null = null

    for (const shape of shapes) {
      const props = shape.props as Record<string, any>
      const itemId =
        props.noteId || props.textId || props.checklistId ||
        props.kanbanId || props.mediaId || props.reminderId || props.tableId ||
        props.richTextId

      if (itemId === fromId) {
        fromShape = {
          x: shape.x,
          y: shape.y,
          w: (props.w as number) || 200,
          h: (props.h as number) || 200,
        }
      }
      if (itemId === toId) {
        toShape = {
          x: shape.x,
          y: shape.y,
          w: (props.w as number) || 200,
          h: (props.h as number) || 200,
        }
      }
      if (fromShape && toShape) break
    }

    if (!fromShape || !toShape) {
      el.setAttribute('d', '')
      return
    }

    // Determine connection sides based on relative position
    const fromCenterX = fromShape.x + fromShape.w / 2
    const fromCenterY = fromShape.y + fromShape.h / 2
    const toCenterX = toShape.x + toShape.w / 2
    const toCenterY = toShape.y + toShape.h / 2

    // Determine which side of each shape the line should connect to
    const dx = toCenterX - fromCenterX
    const dy = toCenterY - fromCenterY

    let fromX: number, fromY: number, toX: number, toY: number

    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal connection
      if (dx > 0) {
        // To is to the right of From
        fromX = fromShape.x + fromShape.w // right side of from
        fromY = fromCenterY
        toX = toShape.x // left side of to
        toY = toCenterY
      } else {
        // To is to the left of From
        fromX = fromShape.x // left side of from
        fromY = fromCenterY
        toX = toShape.x + toShape.w // right side of to
        toY = toCenterY
      }
    } else {
      // Vertical connection
      if (dy > 0) {
        // To is below From
        fromX = fromCenterX
        fromY = fromShape.y + fromShape.h // bottom of from
        toX = toCenterX
        toY = toShape.y // top of to
      } else {
        // To is above From
        fromX = fromCenterX
        fromY = fromShape.y // top of from
        toX = toCenterX
        toY = toShape.y + toShape.h // bottom of to
      }
    }

    // Draw cubic Bézier — same style as custom canvas
    const midX = (fromX + toX) / 2
    const midY = (fromY + toY) / 2

    // Use a smooth S-curve: horizontal bias for horizontal connections, vertical for vertical
    let d: string
    if (Math.abs(dx) > Math.abs(dy)) {
      // Horizontal S-curve
      d = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
    } else {
      // Vertical S-curve
      d = `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`
    }

    el.setAttribute('d', d)
  }, [shapes, fromId, toId])

  return (
    <path
      ref={pathRef}
      stroke={color}
      strokeWidth={2}
      fill="none"
      strokeLinecap="round"
      className="tldraw-connection-line"
      style={{ pointerEvents: 'none' }}
    />
  )
}
