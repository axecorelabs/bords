'use client'

import { useEffect, useRef } from 'react'
import { useCollabStore } from '@/store/collabStore'
import { globalEditorRef } from '@/tldraw/TldrawCanvas'
import { getCursorPosition } from '@/lib/cursor-positions'

/**
 * RemoteCursors — renders cursor pointers for all remote collaborators.
 *
 * Positions arrive in board-space (tldraw page) coordinates from awareness and are
 * converted to screen-space with the local camera every frame, so panning/zooming
 * never leaves cursors behind.
 *
 * Moves do NOT go through React: awareness writes positions to cursor-positions.ts,
 * and one requestAnimationFrame loop moves each cursor's DOM node directly. The loop
 * eases each cursor toward its latest position, which hides network jitter (updates
 * arrive in uneven bursts) without adding a fixed delay the way a CSS transition did.
 */

// Time constant of the easing, in ms. Smaller = snappier, larger = smoother.
const SMOOTHING_MS = 45

export function RemoteCursors() {
  const remoteUsers = useCollabStore(s => s.remoteUsers)
  const isCollaborating = useCollabStore(s => s.isCollaborating)
  const nodes = useRef(new Map<number, HTMLDivElement>())
  const smoothed = useRef(new Map<number, { x: number; y: number }>())

  useEffect(() => {
    if (!isCollaborating) return

    let rafId = 0
    let last = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(now - last, 100)
      last = now
      const alpha = 1 - Math.exp(-dt / SMOOTHING_MS)
      const editor = globalEditorRef

      for (const [clientId, node] of nodes.current) {
        const target = getCursorPosition(clientId)
        if (!target) {
          node.style.display = 'none'
          smoothed.current.delete(clientId)
          continue
        }

        let cur = smoothed.current.get(clientId)
        if (!cur) {
          cur = { x: target.x, y: target.y } // first sighting: appear in place, don't fly in from 0,0
          smoothed.current.set(clientId, cur)
        } else {
          cur.x += (target.x - cur.x) * alpha
          cur.y += (target.y - cur.y) * alpha
        }

        // Board-space (tldraw page) → screen-space using the local camera
        const screen = editor ? editor.pageToScreen({ x: cur.x, y: cur.y }) : cur
        node.style.display = 'block'
        node.style.transform = `translate3d(${screen.x - 2}px, ${screen.y - 2}px, 0)`
      }

      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [isCollaborating])

  if (!isCollaborating) return null

  // Every remote user gets a node; the frame loop shows it only while a position exists. That keeps
  // cursors independent of the (slower) awareness-derived list: a direct update can reveal one immediately.
  const usersWithCursors = remoteUsers
  if (usersWithCursors.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[45] overflow-hidden">
      {usersWithCursors.map((u) => (
        <div
          key={u.clientId}
          ref={(el) => {
            if (el) nodes.current.set(u.clientId, el)
            else {
              nodes.current.delete(u.clientId)
              smoothed.current.delete(u.clientId)
            }
          }}
          className="absolute left-0 top-0"
          style={{ display: 'none', willChange: 'transform' }}
        >
          {/* Cursor arrow SVG */}
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="drop-shadow-md">
            <path
              d="M3 2L17 10L10 11L7 18L3 2Z"
              fill={u.user.color}
              stroke="white"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
          {/* Name label */}
          <div
            className="absolute left-4 top-4 px-1.5 py-0.5 rounded text-[10px] font-semibold text-white whitespace-nowrap shadow-sm"
            style={{ backgroundColor: u.user.color }}
          >
            {u.user.name.split(' ')[0]}
          </div>
        </div>
      ))}
    </div>
  )
}
