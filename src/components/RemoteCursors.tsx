'use client'

import { useCollabStore } from '@/store/collabStore'
import { globalEditorRef } from '@/tldraw/TldrawCanvas'
import { useEffect, useState } from 'react'
import type { Editor } from 'tldraw'

/**
 * RemoteCursors — renders cursor pointers for all remote collaborators.
 * Receives board-space (tldraw page) coordinates from awareness and converts
 * them to screen-space using the tldraw editor's camera.
 */
export function RemoteCursors() {
  const remoteUsers = useCollabStore(s => s.remoteUsers)
  const isCollaborating = useCollabStore(s => s.isCollaborating)
  // Force re-render periodically so cursor positions update with camera changes
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!isCollaborating) return

    let rafId: number | null = null
    let storeUnsub: (() => void) | null = null
    let pollId: ReturnType<typeof setInterval> | null = null

    const attach = (editor: Editor) => {
      storeUnsub = editor.store.listen(() => {
        if (rafId !== null) return
        rafId = requestAnimationFrame(() => {
          rafId = null
          setTick(t => t + 1)
        })
      }, { scope: 'session' })
    }

    if (globalEditorRef) {
      attach(globalEditorRef)
    } else {
      // Editor not mounted yet — poll until it is, then subscribe.
      // Clears itself as soon as the editor is available.
      pollId = setInterval(() => {
        if (globalEditorRef) {
          clearInterval(pollId!)
          pollId = null
          attach(globalEditorRef)
        }
      }, 50)
    }

    return () => {
      if (pollId !== null) clearInterval(pollId)
      storeUnsub?.()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [isCollaborating])

  if (!isCollaborating) return null

  const usersWithCursors = remoteUsers.filter(u => u.cursor)
  if (usersWithCursors.length === 0) return null

  const editor = globalEditorRef

  return (
    <div className="pointer-events-none fixed inset-0 z-[45] overflow-hidden">
      {usersWithCursors.map((u) => {
        const { x, y } = u.cursor!
        // Convert board-space (tldraw page) → screen-space using the local camera
        let screenX = x
        let screenY = y
        if (editor) {
          const sp = editor.pageToScreen({ x, y })
          screenX = sp.x
          screenY = sp.y
        }
        return (
          <div
            key={u.clientId}
            className="absolute transition-all duration-100 ease-out"
            style={{
              left: screenX,
              top: screenY,
              transform: 'translate(-2px, -2px)',
            }}
          >
            {/* Cursor arrow SVG */}
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="drop-shadow-md"
            >
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
        )
      })}
    </div>
  )
}
