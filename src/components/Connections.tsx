'use client'
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link2, Trash2, Eye, X, ChevronUp, ChevronDown } from 'lucide-react'
import { useConnectionStore } from '../store/connectionStore'
import { useBoardStore } from '../store/boardStore'
import { useThemeStore } from '../store/themeStore'
import { ConnectionsModal } from './ConnectionsModal'
import toast from 'react-hot-toast'

interface ConnectionLineProps {
  fromId: string;
  toId: string;
  color: string;
}

function ConnectionLine({ fromId, toId, color }: ConnectionLineProps) {
  const pathRef = useRef<SVGPathElement>(null)

  useEffect(() => {
    const el = pathRef.current
    if (!el) return

    // Direct DOM updates — no React state, no re-renders
    const updatePath = () => {
      const fromIndicator = document.querySelector(`[data-connection-id="${fromId}-indicator"]`)
      const toIndicator = document.querySelector(`[data-connection-id="${toId}-indicator"]`)
      if (!fromIndicator || !toIndicator) return

      const fromRect = fromIndicator.getBoundingClientRect()
      const toRect = toIndicator.getBoundingClientRect()

      const fromX = fromRect.left + (fromRect.width / 2)
      const fromY = fromRect.top + (fromRect.height / 2)
      const toX = toRect.left + (toRect.width / 2)
      const toY = toRect.top + (toRect.height / 2)

      const midX = (fromX + toX) / 2
      el.setAttribute('d', `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`)
    }

    // Register with the event-driven update system
    connectionLineUpdaters.add(updatePath)
    installGlobalListeners()

    // Initial position
    updatePath()

    // If one or both indicators aren't in the DOM yet (e.g. tldraw shape still
    // mounting), watch for them to appear and retry. This handles the case where
    // a connection is created between shapes that haven't fully rendered yet.
    let observer: MutationObserver | null = null
    const hasIndicators = () =>
      !!document.querySelector(`[data-connection-id="${fromId}-indicator"]`) &&
      !!document.querySelector(`[data-connection-id="${toId}-indicator"]`)

    if (!hasIndicators()) {
      observer = new MutationObserver(() => {
        if (hasIndicators()) {
          updatePath()
          observer?.disconnect()
          observer = null
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }

    return () => {
      connectionLineUpdaters.delete(updatePath)
      observer?.disconnect()
    }
  }, [fromId, toId])

  return (
    <path
      ref={pathRef}
      stroke={color}
      strokeWidth="2"
      fill="none"
      strokeLinecap="round"
      className="connection-line"
      style={{ pointerEvents: 'none' }}
    />
  )
}

// ─── Event-driven connection line update system ──────────────────────────────
// Instead of 60fps rAF loop, updates only run when something actually moves:
// scroll, resize, drag events, or DOM mutations on tracked containers.
// Zero CPU when idle.
const connectionLineUpdaters = new Set<() => void>()
let pendingUpdate: number | null = null

/** Schedule a single rAF to update all connection lines. Coalesces multiple events. */
export function scheduleConnectionUpdate() {
  if (connectionLineUpdaters.size === 0) return
  if (pendingUpdate !== null) return // already scheduled
  pendingUpdate = requestAnimationFrame(() => {
    pendingUpdate = null
    connectionLineUpdaters.forEach((fn) => fn())
  })
}

/** Synchronously update all connection line positions (for export capture). */
export function flushConnectionUpdate() {
  connectionLineUpdaters.forEach((fn) => fn())
}

// Continuous loop for active drags only
let dragLoopId: number | null = null
let isDragging = false

export function notifyConnectionsDragStart() {
  isDragging = true
  if (dragLoopId !== null) return
  const tick = () => {
    if (!isDragging || connectionLineUpdaters.size === 0) {
      dragLoopId = null
      isDragging = false
      return
    }
    connectionLineUpdaters.forEach((fn) => fn())
    dragLoopId = requestAnimationFrame(tick)
  }
  dragLoopId = requestAnimationFrame(tick)
}

export function notifyConnectionsDragEnd() {
  isDragging = false
  // One final update after drag ends
  scheduleConnectionUpdate()
}

// Global scroll/resize listeners — installed once when first line mounts
let globalListenersInstalled = false
function installGlobalListeners() {
  if (globalListenersInstalled) return
  globalListenersInstalled = true
  window.addEventListener('scroll', scheduleConnectionUpdate, { capture: true, passive: true })
  window.addEventListener('resize', scheduleConnectionUpdate, { passive: true })
}

/**
 * ConnectionLines — renders ONLY the SVG lines.
 * Intended to be placed in the canvas layer (behind board items).
 */
export function ConnectionLines() {
  const connections = useConnectionStore((state) => state.connections)
  const isVisible = useConnectionStore((state) => state.isVisible)
  const currentBoardId = useBoardStore((state) => state.currentBoardId ?? '')

  const boardConnections = connections.filter(conn => conn.boardId === currentBoardId)

  if (!isVisible || boardConnections.length === 0) return null

  return (
    <>
      <div className="fixed inset-0 pointer-events-none" data-board-connections style={{ zIndex: 0 }}>
        <svg
          className="w-full h-full"
          style={{ pointerEvents: 'none', overflow: 'visible' }}
        >
          {boardConnections.map(connection => (
            <ConnectionLine
              key={connection.id}
              fromId={connection.fromId}
              toId={connection.toId}
              color={connection.color}
            />
          ))}
        </svg>
      </div>
      <style>{`
        .connection-line {
          filter: drop-shadow(0 0 4px rgba(0,0,0,0.1));
        }
        .connection-line:hover {
          stroke-opacity: 1;
          filter: drop-shadow(0 0 6px rgba(0,0,0,0.2));
        }
      `}</style>
    </>
  )
}

export function Connections() {
  const [showConnectionsView, setShowConnectionsView] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(true)
  const { 
    removeConnection, 
    selectedItems, 
    addConnection, 
    clearSelection,
    clearBoardConnections // Use the new method
  } = useConnectionStore()
  const connections = useConnectionStore((state) => state.connections)
  const isVisible = useConnectionStore((state) => state.isVisible)
  const currentBoardId = useBoardStore((state) => state.currentBoardId ?? '')
  const isDark = useThemeStore((state) => state.isDark)

  // Filter connections by current board
  const boardConnections = connections.filter(conn => conn.boardId === currentBoardId)

  const formatConnectionText = (text: string | undefined) => {
    if (!text) return "Untitled";
    // Limit text length and add ellipsis if needed
    return text.length > 50 ? text.substring(0, 50) + "..." : text;
  }

  // Clear connections button handler
  const handleClearConnections = () => {
    if (currentBoardId) {
      clearBoardConnections(currentBoardId)
      toast.success('Cleared all connections for this board', { duration: 1500 })
    }
  }

  if (!isVisible) return null

  return (
    <>
      {/* Connection Controls */}
      <div className="fixed left-4 bottom-4 z-50 pointer-events-auto">
        {boardConnections.length > 0 && (
          <div className={`rounded-xl shadow-lg border backdrop-blur-xl overflow-hidden ${
            isDark 
              ? 'bg-zinc-800/95 border-zinc-700/50' 
              : 'bg-white/95 border-zinc-200/50'
          }`}>
            <AnimatePresence initial={false} mode="wait">
              {isCollapsed ? (
                <motion.div
                  key="collapsed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-2 px-3 py-2"
                >
                  <Link2 size={16} className="text-blue-500" />
                  <span className={`font-semibold text-sm ${
                    isDark ? 'text-white' : 'text-zinc-900'
                  }`}>
                    {boardConnections.length}
                  </span>
                  <button
                    onClick={() => setIsCollapsed(false)}
                    className={`p-1 rounded transition-colors ${
                      isDark ? 'hover:bg-zinc-700' : 'hover:bg-gray-100'
                    }`}
                  >
                    <ChevronUp size={14} className={isDark ? 'text-zinc-400' : 'text-gray-600'} />
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="expanded"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  transition={{ duration: 0.2 }}
                  className="p-3"
                >
                  <div className="flex flex-col gap-2">
                    {/* Header with count and collapse button */}
                    <div className="flex items-center justify-between pb-2 border-b border-zinc-200/50 dark:border-zinc-700/50">
                      <div className="flex items-center gap-2">
                        <Link2 size={16} className="text-blue-500" />
                        <span className={`font-semibold text-sm ${
                          isDark ? 'text-white' : 'text-zinc-900'
                        }`}>
                          {boardConnections.length} Connection{boardConnections.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <button
                        onClick={() => setIsCollapsed(true)}
                        className={`p-1 rounded transition-colors ${
                          isDark ? 'hover:bg-zinc-700' : 'hover:bg-gray-100'
                        }`}
                      >
                        <ChevronDown size={14} className={isDark ? 'text-zinc-400' : 'text-gray-600'} />
                      </button>
                    </div>
                    
                    {/* Action buttons stacked vertically */}
                    {/* <div className="flex flex-col gap-1.5 pt-1">
                      <button
                        onClick={() => setShowConnectionsView(true)}
                        className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-all hover:scale-[1.02] w-full ${
                          isDark 
                            ? 'text-blue-400 hover:bg-blue-500/10' 
                            : 'text-blue-600 hover:bg-blue-50'
                        }`}
                      >
                        <Eye size={16} />
                        View Connections
                      </button>
                      <button
                        onClick={handleClearConnections}
                        className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-all hover:scale-[1.02] w-full ${
                          isDark 
                            ? 'text-red-400 hover:bg-red-500/10' 
                            : 'text-red-600 hover:bg-red-50'
                        }`}
                      >
                        <Trash2 size={16} />
                        Clear All
                      </button>
                    </div> */}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Connections Modal */}
      {showConnectionsView && (
        <ConnectionsModal
          onClose={() => setShowConnectionsView(false)}
          connections={boardConnections}
        />
      )}

      {/* Connect/Disconnect Button - High z-index */}
      {selectedItems.length === 2 && (() => {
        const alreadyConnected = connections.find(
          conn =>
            (conn.fromId === selectedItems[0].id && conn.toId === selectedItems[1].id) ||
            (conn.fromId === selectedItems[1].id && conn.toId === selectedItems[0].id)
        )
        return alreadyConnected ? (
          <motion.button
            key="disconnect"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="fixed top-4 right-20 z-[100000] bg-red-500 text-white px-3 py-2 rounded-lg 
                     shadow-lg flex items-center gap-2 hover:bg-red-600 transition-colors pointer-events-auto"
            onClick={() => {
              removeConnection(alreadyConnected.id)
              clearSelection()
              toast.success('Items disconnected', { duration: 1500 })
            }}
          >
            <Link2 size={16} />
            Disconnect Items
          </motion.button>
        ) : (
          <motion.button
            key="connect"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="fixed top-4 right-20 z-[100000] bg-blue-500 text-white px-3 py-2 rounded-lg 
                     shadow-lg flex items-center gap-2 hover:bg-blue-600 transition-colors pointer-events-auto"
            onClick={() => {
              // Validate both items exist in DOM
              const item1Exists = document.querySelector(`[data-node-id="${selectedItems[0].id}"]`)
              const item2Exists = document.querySelector(`[data-node-id="${selectedItems[1].id}"]`)
              
              if (!item1Exists || !item2Exists) {
                toast.error('Cannot connect: One or more items not found', { duration: 1500 })
                return
              }
              
              addConnection(
                selectedItems[0].id,
                selectedItems[1].id,
                selectedItems[0].type,
                selectedItems[1].type,
                {
                  from: selectedItems[0].position,
                  to: selectedItems[1].position
                },
                currentBoardId
              )
              toast.success('Items connected successfully', { duration: 1500 })
            }}
          >
            <Link2 size={16} />
            Connect Items
          </motion.button>
        )
      })()}
    </>
  )
}
