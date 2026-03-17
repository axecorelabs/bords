'use client'

import { useState, useEffect, useRef } from 'react'
import { useCollabStore, type RemoteUser } from '@/store/collabStore'
import { useThemeStore } from '@/store/themeStore'
import { useBoardStore } from '@/store/boardStore'
import { useBoardSyncStore } from '@/store/boardSyncStore'
import { useSession } from '@/components/AuthProvider'

// Y.Doc is always cloud-connected — every board with an active collab session is a "cloud board"

/**
 * ActiveCollaborators — shows stacked avatars of users currently
 * connected to the board. Clicking opens a popover with details.
 *
 * Data sources (layered):
 * 1. collabStore.remoteUsers — real-time via Yjs awareness (primary)
 * 2. /api/rooms/:boardId/connections — REST snapshot (fallback / supplement)
 */
export function ActiveCollaborators() {
  const { data: session } = useSession()
  const isDark = useThemeStore(s => s.isDark)
  const currentBoardId = useBoardStore(s => s.currentBoardId)
  const isCollaborating = useCollabStore(s => s.isCollaborating)
  const connectionStatus = useCollabStore(s => s.connectionStatus)
  const remoteUsers = useCollabStore(s => s.remoteUsers)
  const [showPopover, setShowPopover] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // With Y.Doc as source of truth, every board with a collab session is a cloud board
  const isCloudBoard = isCollaborating

  // Close popover on outside click
  useEffect(() => {
    if (!showPopover) return
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setShowPopover(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPopover])

  // Merge awareness users with current user, deduplicate by userId
  const currentUserId = (session?.user as any)?.id || session?.user?.email
  const currentBoardPermission = useBoardSyncStore(s => s.boardPermissions[currentBoardId || ''] || 'owner') as 'owner' | 'edit' | 'view'
  const mergedUsers = getMergedUsers(remoteUsers, currentUserId, {
    session,
    permission: currentBoardPermission,
  })

  if (!isCloudBoard || mergedUsers.length === 0) return null

  const MAX_VISIBLE = 4
  const visible = mergedUsers.slice(0, MAX_VISIBLE)
  const overflow = mergedUsers.length - MAX_VISIBLE

  return (
    <div className="relative" ref={popoverRef}>
      {/* Avatar stack */}
      <button
        onClick={() => setShowPopover(prev => !prev)}
        className="flex items-center -space-x-2 hover:opacity-90 transition-opacity"
        title={`${mergedUsers.length} collaborator${mergedUsers.length !== 1 ? 's' : ''} online`}
      >
        {visible.map((u) => (
          <div
            key={u.userId}
            className={`relative w-8 h-8 rounded-full ring-2 ring-offset-1 flex items-center justify-center text-xs font-bold text-white shrink-0 ${isDark ? 'ring-zinc-800' : 'ring-white'}`}
            style={{ backgroundColor: u.color }}
            title={u.isYou ? `${u.name} (You)` : u.name}
          >
            <img
              src={u.avatar || getPlaceholderAvatar(u.name, u.color, 64)}
              alt={u.name}
              className="w-full h-full rounded-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).src = getPlaceholderAvatar(u.name, u.color, 64) }}
            />
            {/* Online indicator dot */}
            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ${isDark ? 'ring-zinc-800' : 'ring-white'}`} />
          </div>
        ))}
        {overflow > 0 && (
          <div
            className={`w-8 h-8 rounded-full ring-2 ring-offset-1 flex items-center justify-center text-xs font-semibold shrink-0
              ${isDark
                ? 'bg-zinc-700 text-zinc-300 ring-zinc-800'
                : 'bg-zinc-200 text-zinc-600 ring-white'}`}
          >
            +{overflow}
          </div>
        )}

        {/* Connection status indicator next to avatars */}
        {isCollaborating && (
          <div className={`ml-3 flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold
            ${connectionStatus === 'connected'
              ? isDark ? 'bg-green-500/15 text-green-400' : 'bg-green-50 text-green-600'
              : connectionStatus === 'error'
                ? isDark ? 'bg-red-500/15 text-red-400' : 'bg-red-50 text-red-600'
                : isDark ? 'bg-amber-500/15 text-amber-400' : 'bg-amber-50 text-amber-600'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500'
                : connectionStatus === 'error' ? 'bg-red-500'
                : 'bg-amber-500 animate-pulse'
            }`} />
            {connectionStatus === 'connected' ? 'Live'
              : connectionStatus === 'error' ? 'Offline'
              : 'Reconnecting…'}
          </div>
        )}
      </button>

      {/* Popover — user list */}
      {showPopover && (
        <div
          className={`absolute top-full right-0 mt-2 w-72 rounded-xl border shadow-xl overflow-hidden z-50
            ${isDark
              ? 'bg-zinc-800 border-zinc-700'
              : 'bg-white border-zinc-200'}`}
        >
          <div className={`px-4 py-2.5 border-b text-xs font-semibold uppercase tracking-wider
            ${isDark ? 'border-zinc-700 text-zinc-400' : 'border-zinc-100 text-zinc-500'}`}>
            {mergedUsers.length} Collaborator{mergedUsers.length !== 1 ? 's' : ''} Online
          </div>
          <div className="max-h-64 overflow-y-auto">
            {mergedUsers.map((u) => (
              <div
                key={u.userId}
                className={`flex items-center gap-3 px-4 py-2.5 transition-colors
                  ${isDark ? 'hover:bg-zinc-700/40' : 'hover:bg-zinc-50'}`}
              >
                {/* Avatar */}
                <div
                  className="relative w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                  style={{ backgroundColor: u.color }}
                >
                  <img
                    src={u.avatar || getPlaceholderAvatar(u.name, u.color, 72)}
                    alt={u.name}
                    className="w-full h-full rounded-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).src = getPlaceholderAvatar(u.name, u.color, 72) }}
                  />
                  <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ${isDark ? 'ring-zinc-800' : 'ring-white'}`} />
                </div>

                {/* Name + permission */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    {u.isYou ? `${u.name} (You)` : u.name}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full
                      ${u.permission === 'owner'
                        ? isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-100 text-purple-700'
                        : u.permission === 'edit'
                          ? isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
                          : isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'}`}
                    >
                      {u.permission === 'owner' ? 'OWNER' : u.permission === 'edit' ? 'EDITOR' : 'VIEWER'}
                    </span>
                    {u.editingItem && (
                      <span className={`text-[10px] truncate max-w-[100px]
                        ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                        Editing…
                      </span>
                    )}
                  </div>
                </div>

                {/* Cursor presence dot */}
                {u.cursor && (
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: u.color }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─────────── Helpers ─────────── */

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (name[0] || '?').toUpperCase()
}

function getPlaceholderAvatar(name: string, color: string, size = 64): string {
  const initials = getInitials(name)
  const bg = color.replace('#', '')
  return `https://placehold.co/${size}x${size}/${bg}/ffffff?text=${encodeURIComponent(initials)}&font=roboto`
}

interface MergedUser {
  userId: string
  name: string
  avatar: string | null
  color: string
  permission: 'owner' | 'edit' | 'view'
  cursor: { x: number; y: number } | null
  editingItem: string | null
  isYou?: boolean
}

const PRESENCE_COLORS = [
  '#e57373', '#f06292', '#ba68c8', '#9575cd',
  '#7986cb', '#64b5f6', '#4fc3f7', '#4dd0e1',
  '#4db6ac', '#81c784', '#aed581', '#dce775',
  '#fff176', '#ffd54f', '#ffb74d', '#ff8a65',
]

function getUserColor(userId: string): string {
  let hash = 0
  for (const char of userId) {
    hash = ((hash << 5) - hash) + char.charCodeAt(0)
    hash |= 0
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length]
}

function getMergedUsers(
  awareness: RemoteUser[],
  currentUserId: string | undefined,
  currentUser?: { session: any; permission: 'owner' | 'edit' | 'view' }
): MergedUser[] {
  const map = new Map<string, MergedUser>()

  // Add the current user first ("You")
  if (currentUserId && currentUser?.session?.user) {
    const s = currentUser.session.user
    map.set(currentUserId, {
      userId: currentUserId,
      name: s.name || s.email || 'You',
      avatar: s.image || null,
      color: getUserColor(currentUserId),
      permission: currentUser.permission,
      cursor: null,
      editingItem: null,
      isYou: true,
    })
  }

  // Awareness users (real-time via WebSocket)
  for (const u of awareness) {
    if (u.user.id === currentUserId) continue
    map.set(u.user.id, {
      userId: u.user.id,
      name: u.user.name,
      avatar: u.user.avatar,
      color: u.user.color || getUserColor(u.user.id),
      permission: u.user.permission ?? 'edit',
      cursor: u.cursor,
      editingItem: u.editingItem,
    })
  }

  // Ensure "You" is always first
  const result = Array.from(map.values())
  const youIdx = result.findIndex(u => u.isYou)
  if (youIdx > 0) {
    const [you] = result.splice(youIdx, 1)
    result.unshift(you)
  }
  return result
}
