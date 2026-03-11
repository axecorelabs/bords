'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useRoomContext,
  useParticipants,
} from '@livekit/components-react'
import { useCallStore } from '@/store/callStore'
import { ParticipantGrid } from './ParticipantGrid'
import { CallControls } from './CallControls'
import { Minimize2, Maximize2, X, GripHorizontal, Users } from 'lucide-react'

/**
 * Inner component that has access to the LiveKit room context
 * to keep track toggles in sync with actual track state.
 */
function RoomContent() {
  const { localParticipant } = useLocalParticipant()
  const {
    isMicEnabled,
    isCameraEnabled,
    isScreenSharing,
    setScreenSharing,
  } = useCallStore()

  useEffect(() => {
    localParticipant.setMicrophoneEnabled(isMicEnabled)
  }, [isMicEnabled, localParticipant])

  useEffect(() => {
    localParticipant.setCameraEnabled(isCameraEnabled)
  }, [isCameraEnabled, localParticipant])

  useEffect(() => {
    if (isScreenSharing) {
      localParticipant.setScreenShareEnabled(true).catch(() => {
        setScreenSharing(false)
      })
    } else {
      localParticipant.setScreenShareEnabled(false)
    }
  }, [isScreenSharing, localParticipant, setScreenSharing])

  return (
    <>
      <ParticipantGrid />
      <RoomAudioRenderer />
    </>
  )
}

/** Participant count badge shown inside the LiveKit context */
function ParticipantCount() {
  const participants = useParticipants()
  return (
    <span className="flex items-center gap-1 text-xs text-zinc-400">
      <Users size={12} />
      {participants.length}
    </span>
  )
}

// Panel sizes
const EXPANDED = { w: 560, h: 420 }
const COLLAPSED = { w: 280, h: 64 }

export function CallRoom() {
  const {
    isInCall,
    livekitToken,
    livekitUrl,
    isCallPanelOpen,
    setCallPanelOpen,
    leaveCall,
  } = useCallStore()

  // Drag state
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [hasUserDragged, setHasUserDragged] = useState(false)
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  // Compute default position (bottom-right, above dock)
  const getDefaultPos = useCallback(() => {
    const size = isCallPanelOpen ? EXPANDED : COLLAPSED
    return {
      x: window.innerWidth - size.w - 16,
      y: window.innerHeight - size.h - 88,
    }
  }, [isCallPanelOpen])

  // Set initial position
  useEffect(() => {
    if (!hasUserDragged) {
      setPos(getDefaultPos())
    }
  }, [isCallPanelOpen, hasUserDragged, getDefaultPos])

  // Clamp position to viewport on resize
  useEffect(() => {
    const onResize = () => {
      setPos((prev) => {
        const size = isCallPanelOpen ? EXPANDED : COLLAPSED
        return {
          x: Math.min(prev.x, window.innerWidth - size.w - 8),
          y: Math.min(prev.y, window.innerHeight - size.h - 8),
        }
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [isCallPanelOpen])

  // Drag handlers
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y }
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture(e.pointerId)
  }, [pos])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    const size = isCallPanelOpen ? EXPANDED : COLLAPSED
    const newX = Math.max(0, Math.min(window.innerWidth - size.w, dragState.current.originX + dx))
    const newY = Math.max(0, Math.min(window.innerHeight - size.h, dragState.current.originY + dy))
    setPos({ x: newX, y: newY })
    setHasUserDragged(true)
  }, [isCallPanelOpen])

  const onPointerUp = useCallback(() => {
    dragState.current = null
  }, [])

  if (!isInCall || !livekitToken) return null

  const size = isCallPanelOpen ? EXPANDED : COLLAPSED

  return (
    <div
      ref={panelRef}
      className="fixed z-[60]"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
        transition: dragState.current ? 'none' : 'width 0.3s ease, height 0.3s ease',
      }}
    >
      <div className="w-full h-full rounded-2xl overflow-hidden shadow-2xl border border-zinc-700/50 bg-zinc-900/95 backdrop-blur-xl flex flex-col">
        {/* Header — draggable */}
        <div
          className="flex items-center justify-between px-3 py-2 bg-zinc-800/80 border-b border-zinc-700/50 cursor-grab active:cursor-grabbing select-none flex-shrink-0"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div className="flex items-center gap-2">
            <GripHorizontal size={14} className="text-zinc-500" />
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-xs font-medium text-zinc-300">In call</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setCallPanelOpen(!isCallPanelOpen)}
              className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
              title={isCallPanelOpen ? 'Minimize' : 'Expand'}
            >
              {isCallPanelOpen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              onClick={leaveCall}
              className="p-1 rounded hover:bg-red-500/30 text-zinc-400 hover:text-red-400 transition-colors"
              title="Leave call"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* LiveKit Room */}
        <LiveKitRoom
          token={livekitToken}
          serverUrl={livekitUrl}
          connect={true}
          onDisconnected={leaveCall}
          className="flex-1 flex flex-col overflow-hidden"
        >
          {/* Expanded: show grid + controls. Collapsed: show compact bar */}
          {isCallPanelOpen ? (
            <>
              <RoomContent />
              <CallControls />
            </>
          ) : (
            <div className="flex items-center justify-between px-3 flex-1">
              <ParticipantCount />
              <CallControls compact />
            </div>
          )}
        </LiveKitRoom>
      </div>
    </div>
  )
}
