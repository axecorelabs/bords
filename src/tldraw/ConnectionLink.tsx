'use client'
import { Link2 } from 'lucide-react'
import { useConnectionStore, type ConnectionItemType } from '@/store/connectionStore'
import { useBoardStore } from '@/store/boardStore'
import { useState, useEffect, useCallback } from 'react'
import { scheduleConnectionUpdate } from '@/components/Connections'
import toast from 'react-hot-toast'

/* ─────────────────────────────────────────────
 *  ConnectionLinkButton
 *  Drop into any shape's hover toolbar.
 *  Click once → select as source.
 *  Click another shape's button → auto-connect.
 *  Click the same again → cancel.
 * ───────────────────────────────────────────── */

interface ConnectionLinkButtonProps {
  itemId: string
  itemType: ConnectionItemType
  /** Override default inline styles (for shapes with different toolbar styling) */
  style?: React.CSSProperties
  /** Icon size override */
  size?: number
}

export function ConnectionLinkButton({
  itemId,
  itemType,
  style,
  size = 14,
}: ConnectionLinkButtonProps) {
  const selectedItems = useConnectionStore((s) => s.selectedItems)
  const connections = useConnectionStore((s) => s.connections)
  const { selectItem, clearSelection, addConnection, removeConnection } = useConnectionStore()
  const currentBoardId = useBoardStore((s) => s.currentBoardId)

  const isSelected = selectedItems.some((item) => item.id === itemId)
  const otherSelected = selectedItems.length === 1 ? selectedItems[0] : null
  const hasOtherSelected = otherSelected && otherSelected.id !== itemId

  // Check if already connected to the other selected item
  const existingConnection = hasOtherSelected
    ? connections.find(
        (c) =>
          (c.fromId === itemId && c.toId === otherSelected.id) ||
          (c.fromId === otherSelected.id && c.toId === itemId)
      )
    : null

  const handleClick = (e: React.PointerEvent) => {
    e.stopPropagation()
    if (!itemId) return // guard against uninitialized shapes

    if (isSelected) {
      // Cancel selection
      clearSelection()
      toast('Connection cancelled', { icon: '❌', duration: 1200 })
      return
    }

    if (hasOtherSelected) {
      // Second selection → auto-connect or disconnect
      if (existingConnection) {
        removeConnection(existingConnection.id)
        clearSelection()
        toast.success('Disconnected!', { duration: 1500 })
      } else {
        addConnection(
          otherSelected.id,
          itemId,
          otherSelected.type,
          itemType,
          { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
          currentBoardId || ''
        )
        toast.success('Connected!', { duration: 1500 })
      }
    } else {
      // First selection
      selectItem(itemId, itemType, { x: 0, y: 0 })
      toast('Click the link button on another shape', { icon: '🔗', duration: 2500 })
    }
  }

  // Visual states
  const buttonColor = isSelected
    ? '#3b82f6' // blue when selected
    : hasOtherSelected
      ? '#10b981' // green when another shape is waiting
      : '#6b7280' // gray default

  const buttonBg = isSelected
    ? 'rgba(59,130,246,0.15)'
    : hasOtherSelected
      ? 'rgba(16,185,129,0.1)'
      : 'none'

  const title = isSelected
    ? 'Cancel connection'
    : hasOtherSelected
      ? existingConnection
        ? 'Disconnect from selected shape'
        : 'Connect to selected shape'
      : 'Connect to another shape'

  return (
    <button
      onPointerDown={handleClick}
      style={{
        padding: 10,
        border: 'none',
        background: buttonBg,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'inherit',
        transition: 'background 0.15s',
        ...style,
      }}
      title={title}
    >
      <Link2
        size={size}
        color={buttonColor}
        style={{
          transition: 'color 0.15s',
          ...(isSelected ? { animation: 'connectionPulse 1.5s ease-in-out infinite' } : {}),
        }}
      />
    </button>
  )
}

/* ─────────────────────────────────────────────
 *  ConnectionSelectionRing
 *  Always rendered in the shape root div.
 *  Shows a pulsing blue ring when shape is
 *  selected as the connection source.
 * ───────────────────────────────────────────── */

export function ConnectionSelectionRing({ itemId }: { itemId: string }) {
  const isSelected = useConnectionStore((s) =>
    s.selectedItems.some((item) => item.id === itemId)
  )

  if (!isSelected) return null

  return (
    <>
      <style>{`
        @keyframes connectionPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes connectionRingPulse {
          0%, 100% { box-shadow: 0 0 0 2px rgba(59,130,246,0.6), 0 0 8px rgba(59,130,246,0.3); }
          50% { box-shadow: 0 0 0 3px rgba(59,130,246,0.4), 0 0 16px rgba(59,130,246,0.2); }
        }
      `}</style>
      <div
        style={{
          position: 'absolute',
          inset: -4,
          borderRadius: 12,
          border: '2px solid rgba(59,130,246,0.6)',
          pointerEvents: 'none',
          zIndex: 1,
          animation: 'connectionRingPulse 1.5s ease-in-out infinite',
        }}
      />
      {/* Small "Linking..." badge */}
      <div
        style={{
          position: 'absolute',
          bottom: -12,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#3b82f6',
          color: 'white',
          fontSize: 9,
          fontWeight: 600,
          padding: '2px 8px',
          borderRadius: 9999,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 3,
          boxShadow: '0 2px 8px rgba(59,130,246,0.3)',
        }}
      >
        Linking…
      </div>
    </>
  )
}

/* ─────────────────────────────────────────────
 *  ConnectionIndicator
 *  Renders one pulsing dot per side that has at least one connection.
 *  A count badge appears when multiple connections share the same side.
 * ───────────────────────────────────────────── */

type Side = 'left' | 'right' | 'top' | 'bottom'

const SIDE_POS: Record<Side, React.CSSProperties> = {
  right:  { top: '50%',  right: -6,  transform: 'translateY(-50%)' },
  left:   { top: '50%',  left: -6,   transform: 'translateY(-50%)' },
  top:    { top: -6,     left: '50%', transform: 'translateX(-50%)' },
  bottom: { bottom: -6,  left: '50%', transform: 'translateX(-50%)' },
}

export function ConnectionIndicator({ itemId }: { itemId: string }) {
  const isVisible = useConnectionStore((s) => s.isVisible)
  const isConnected = useConnectionStore((s) =>
    s.connections.some((c) => c.fromId === itemId || c.toId === itemId)
  )
  // Stable string that changes only when this item's connection set changes.
  // Used to immediately flush sideMap when a connection is added or removed.
  const connectionKey = useConnectionStore((s) =>
    s.connections
      .filter((c) => c.fromId === itemId || c.toId === itemId)
      .map((c) => c.id)
      .sort()
      .join(',')
  )

  // Map from connection id → which side of this shape faces that connection
  const [sideMap, setSideMap] = useState<Record<string, Side>>({})

  // Read connections from store inside the callback — never in deps — so
  // useCallback is stable (only itemId matters) and can't cause an update loop.
  const updateSides = useCallback(() => {
    const conns = useConnectionStore.getState().connections.filter(
      (c) => c.fromId === itemId || c.toId === itemId
    )
    const thisEl = document.querySelector(`[data-node-id="${itemId}"]`)
    if (!thisEl) return
    const thisRect = thisEl.getBoundingClientRect()
    const thisCX = thisRect.left + thisRect.width / 2
    const thisCY = thisRect.top + thisRect.height / 2

    const next: Record<string, Side> = {}
    for (const conn of conns) {
      const otherId = conn.fromId === itemId ? conn.toId : conn.fromId
      const otherEl = document.querySelector(`[data-node-id="${otherId}"]`)
      if (!otherEl) continue // other shape not in DOM — skip, no phantom dot
      const otherRect = otherEl.getBoundingClientRect()
      const dx = (otherRect.left + otherRect.width / 2) - thisCX
      const dy = (otherRect.top + otherRect.height / 2) - thisCY
      next[conn.id] = Math.abs(dx) > Math.abs(dy)
        ? (dx < 0 ? 'left' : 'right')
        : (dy < 0 ? 'top' : 'bottom')
    }
    setSideMap(next)
  }, [itemId])

  useEffect(() => {
    updateSides()
    const interval = setInterval(updateSides, 500)
    return () => clearInterval(interval)
  }, [updateSides])

  // Immediately rebuild sideMap when connections for this item change
  // (catches deletions/additions without waiting for the 500ms interval)
  useEffect(() => {
    updateSides()
  }, [connectionKey, updateSides])

  useEffect(() => {
    if (isConnected) requestAnimationFrame(() => scheduleConnectionUpdate())
  }, [sideMap, isConnected])

  if (!isConnected || !isVisible) return null

  // Count connections per side
  const bySide = new Map<Side, number>()
  for (const side of Object.values(sideMap)) {
    bySide.set(side, (bySide.get(side) ?? 0) + 1)
  }
  // If DOM elements aren't ready yet, skip rendering entirely —
  // the 500ms interval will populate sideMap once shapes are mounted.
  if (bySide.size === 0) return null

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
    width: 12,
    height: 12,
    borderRadius: '50%',
    background: '#3b82f6',
    border: '2px solid white',
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    animation: 'ciPulse 2s ease-in-out infinite',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  return (
    <>
      <style>{`@keyframes ciPulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }`}</style>
      {[...bySide.entries()].map(([side, count]) => (
        <div
          key={side}
          data-connection-id={side === 'right' ? `${itemId}-indicator` : undefined}
          data-connection-side={side}
          style={{ ...baseStyle, ...SIDE_POS[side] }}
        >
          {count > 1 && (
            <span style={{
              fontSize: 7,
              fontWeight: 700,
              color: 'white',
              lineHeight: 1,
              userSelect: 'none',
            }}>
              {count}
            </span>
          )}
        </div>
      ))}
    </>
  )
}
