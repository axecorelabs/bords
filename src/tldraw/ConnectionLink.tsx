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
 *  Replaces the static right-side-only indicator.
 *  Dynamically positions on the side facing the
 *  connected shape (matching custom canvas behavior).
 *  Renders a pulsing blue dot when connected.
 * ───────────────────────────────────────────── */

export function ConnectionIndicator({ itemId }: { itemId: string }) {
  const connections = useConnectionStore((s) => s.connections)
  const isVisible = useConnectionStore((s) => s.isVisible)
  const [side, setSide] = useState<'left' | 'right' | 'top' | 'bottom'>('right')

  const isConnected = connections.some(
    (c) => c.fromId === itemId || c.toId === itemId
  )

  const updateSide = useCallback(() => {
    if (!isConnected) return
    const connection = connections.find(
      (c) => c.fromId === itemId || c.toId === itemId
    )
    if (!connection) return
    const otherId = connection.fromId === itemId ? connection.toId : connection.fromId
    const thisEl = document.querySelector(`[data-node-id="${itemId}"]`)
    const otherEl = document.querySelector(`[data-node-id="${otherId}"]`)
    if (!thisEl || !otherEl) return

    const thisRect = thisEl.getBoundingClientRect()
    const otherRect = otherEl.getBoundingClientRect()

    const dx = (otherRect.left + otherRect.width / 2) - (thisRect.left + thisRect.width / 2)
    const dy = (otherRect.top + otherRect.height / 2) - (thisRect.top + thisRect.height / 2)

    // Choose the side facing the other shape
    if (Math.abs(dx) > Math.abs(dy)) {
      setSide(dx < 0 ? 'left' : 'right')
    } else {
      setSide(dy < 0 ? 'top' : 'bottom')
    }
  }, [itemId, isConnected, connections])

  // Update side initially and on connection changes
  useEffect(() => {
    updateSide()
    // Also update whenever connection lines update (shapes move / camera moves)
    const interval = setInterval(updateSide, 500)
    return () => clearInterval(interval)
  }, [updateSide])

  // Trigger a connection line update when this indicator mounts/repositions
  useEffect(() => {
    if (isConnected) {
      // Small delay to let DOM render the indicator at its new position
      requestAnimationFrame(() => scheduleConnectionUpdate())
    }
  }, [side, isConnected])

  if (!isConnected || !isVisible) {
    // Still render an invisible indicator on the right for connection line endpoints
    return (
      <div
        data-connection-id={`${itemId}-indicator`}
        style={{
          position: 'absolute',
          top: '50%',
          right: -4,
          width: 8,
          height: 8,
          pointerEvents: 'none',
        }}
      />
    )
  }

  const positionStyle: React.CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
    width: 12,
    height: 12,
    borderRadius: '50%',
    background: '#3b82f6',
    border: '2px solid white',
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
    animation: 'connectionIndicatorPulse 2s ease-in-out infinite',
    zIndex: 1,
  }

  // Position based on side
  switch (side) {
    case 'left':
      positionStyle.top = '50%'
      positionStyle.left = -6
      positionStyle.transform = 'translateY(-50%)'
      break
    case 'right':
      positionStyle.top = '50%'
      positionStyle.right = -6
      positionStyle.transform = 'translateY(-50%)'
      break
    case 'top':
      positionStyle.top = -6
      positionStyle.left = '50%'
      positionStyle.transform = 'translateX(-50%)'
      break
    case 'bottom':
      positionStyle.bottom = -6
      positionStyle.left = '50%'
      positionStyle.transform = 'translateX(-50%)'
      break
  }

  return (
    <>
      <style>{`
        @keyframes connectionIndicatorPulse {
          0%, 100% { opacity: 1; transform: ${positionStyle.transform || ''} scale(1); }
          50% { opacity: 0.6; transform: ${positionStyle.transform || ''} scale(0.85); }
        }
      `}</style>
      <div
        data-connection-id={`${itemId}-indicator`}
        data-connection-side={side}
        style={positionStyle}
      />
    </>
  )
}
