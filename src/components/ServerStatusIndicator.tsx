'use client'

import { useState, useEffect, useRef } from 'react'
import { useThemeStore } from '@/store/themeStore'
import { useCollabStore } from '@/store/collabStore'
import { fetchServerHealth, type ServerHealth } from '@/lib/collab-api'

/**
 * ServerStatusIndicator — tiny pill that shows the collaboration server status.
 *
 * States:
 * - Connected (green)  — server healthy + WebSocket connected
 * - Degraded (amber)   — server reachable but Mongo/Redis issues
 * - Offline (red)      — server unreachable
 * - Hidden             — not collaborating on any board (no indicator shown)
 */
export function ServerStatusIndicator() {
  const isDark = useThemeStore(s => s.isDark)
  const isCollaborating = useCollabStore(s => s.isCollaborating)
  const connectionStatus = useCollabStore(s => s.connectionStatus)
  const boardId = useCollabStore(s => s.boardId)
  const [health, setHealth] = useState<ServerHealth | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click
  useEffect(() => {
    if (!showDetails) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDetails(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showDetails])

  // Poll server health while collaborating
  useEffect(() => {
    if (!isCollaborating) {
      setHealth(null)
      return
    }

    let cancelled = false

    const check = async () => {
      const h = await fetchServerHealth(boardId || undefined)
      if (!cancelled) setHealth(h)
    }

    check()
    const interval = setInterval(check, 30_000) // every 30s
    return () => { cancelled = true; clearInterval(interval) }
  }, [isCollaborating, connectionStatus, boardId]) // re-poll immediately when connection status changes

  if (!isCollaborating) return null

  const serverOk = health?.status === 'ok'
  const supabaseOk = health?.supabaseStatus === 'connected'
  const redisOk = health?.redisStatus === 'connected'
  const degraded = serverOk && (!supabaseOk || !redisOk)

  // Determine overall status from BOTH server health AND WebSocket state.
  // The WebSocket connectionStatus is the authoritative real-time signal;
  // health is a supplementary HTTP probe.
  const wsConnected = connectionStatus === 'connected'
  const wsConnecting = connectionStatus === 'connecting'
  const wsError = connectionStatus === 'error' || connectionStatus === 'disconnected'

  const statusColor = wsError
    ? 'red'
    : wsConnecting
      ? 'amber'
      : degraded
        ? 'amber'
        : 'green'

  const statusLabel = wsError
    ? serverOk ? 'WebSocket Disconnected' : 'Offline'
    : wsConnecting
      ? 'Connecting…'
      : degraded
        ? 'Degraded'
        : 'Connected'

  const statusText = wsConnected
    ? health ? `${health.roomConnections} online` : 'Live'
    : wsConnecting
      ? 'Connecting…'
      : serverOk
        ? 'Disconnected'
        : 'Offline'

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setShowDetails(prev => !prev)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors border
          ${isDark
            ? `bg-zinc-800/90 border-zinc-700/50 hover:bg-zinc-700/70`
            : `bg-white/90 border-zinc-200/50 hover:bg-zinc-50`}
          shadow-sm backdrop-blur-sm`}
        title={statusLabel}
      >
        <span className={`w-2 h-2 rounded-full ${
          statusColor === 'green'
            ? 'bg-green-500'
            : statusColor === 'amber'
              ? 'bg-amber-500 animate-pulse'
              : 'bg-red-500 animate-pulse'
        }`} />
        <span className={isDark ? 'text-zinc-400' : 'text-zinc-500'}>
          {statusText}
        </span>
      </button>

      {/* Expanded details popover */}
      {showDetails && health && (
        <div
          className={`absolute top-full right-0 mt-2 w-56 rounded-xl border shadow-xl overflow-hidden z-50
            ${isDark
              ? 'bg-zinc-800 border-zinc-700'
              : 'bg-white border-zinc-200'}`}
        >
          <div className={`px-4 py-2.5 border-b text-xs font-semibold uppercase tracking-wider
            ${isDark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-100 text-zinc-500'}`}>
            Collab Server
          </div>
          <div className="px-4 py-3 space-y-2">
            <StatusRow label="Server" ok={serverOk} isDark={isDark} />
            <StatusRow label="Database" ok={supabaseOk} isDark={isDark} />
            <StatusRow label="Pub/Sub" ok={redisOk} isDark={isDark} />
            <StatusRow label="WebSocket" ok={wsConnected} connecting={wsConnecting} isDark={isDark} />
            <div className={`pt-2 border-t text-xs ${isDark ? 'border-zinc-700 text-zinc-500' : 'border-zinc-100 text-zinc-400'}`}>
              <div className="flex justify-between">
                <span>Room connections</span>
                <span className={isDark ? 'text-zinc-300' : 'text-zinc-700'}>{health.roomConnections}</span>
              </div>
              <div className="flex justify-between mt-1">
                <span>Uptime</span>
                <span className={isDark ? 'text-zinc-300' : 'text-zinc-700'}>{formatUptime(health.uptime)}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatusRow({ label, ok, connecting, isDark }: { label: string; ok: boolean; connecting?: boolean; isDark: boolean }) {
  const statusText = connecting ? 'Connecting' : ok ? 'Connected' : 'Down'
  const color = connecting
    ? isDark ? 'text-amber-400' : 'text-amber-600'
    : ok
      ? isDark ? 'text-green-400' : 'text-green-600'
      : isDark ? 'text-red-400' : 'text-red-600'
  const dotColor = connecting ? 'bg-amber-500 animate-pulse' : ok ? 'bg-green-500' : 'bg-red-500'

  return (
    <div className="flex items-center justify-between text-xs">
      <span className={isDark ? 'text-zinc-400' : 'text-zinc-500'}>{label}</span>
      <span className={`flex items-center gap-1.5 font-medium ${color}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        {statusText}
      </span>
    </div>
  )
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}
