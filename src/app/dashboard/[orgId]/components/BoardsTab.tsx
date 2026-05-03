'use client'

import { useState } from 'react'
import { FolderKanban, ExternalLink, Globe, Lock, Loader2, Trash2 } from 'lucide-react'
import { DashboardData, formatRelativeTime } from './types'

export default function BoardsTab({
  data,
  isDark,
  onOpenBoard,
  isOwner,
  currentUserId,
}: {
  data: DashboardData
  isDark: boolean
  onOpenBoard: (localBoardId: string) => void
  isOwner: boolean
  currentUserId: string
}) {
  // Track optimistic visibility state per board
  const [visibilityMap, setVisibilityMap] = useState<Record<string, 'private' | 'org'>>(() =>
    Object.fromEntries(data.boards.map(b => [b._id, b.visibility]))
  )
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [boards, setBoards] = useState(data.boards)

  const handleToggleVisibility = async (e: React.MouseEvent, boardId: string) => {
    e.stopPropagation()
    if (!isOwner || togglingId) return

    const current = visibilityMap[boardId] ?? 'private'
    const next = current === 'private' ? 'org' : 'private'

    setTogglingId(boardId)
    // Optimistic update
    setVisibilityMap(prev => ({ ...prev, [boardId]: next }))

    try {
      const res = await fetch(`/api/bords/${boardId}/access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        // Send visibility only — access list is preserved server-side
        body: JSON.stringify({ visibility: next }),
      })
      if (!res.ok) throw new Error('Failed to update')
    } catch {
      // Revert on failure
      setVisibilityMap(prev => ({ ...prev, [boardId]: current }))
    } finally {
      setTogglingId(null)
    }
  }

  const handleDeleteClick = (e: React.MouseEvent, boardId: string) => {
    e.stopPropagation()
    setConfirmDeleteId(boardId)
  }

  const handleConfirmDelete = async (e: React.MouseEvent, boardId: string) => {
    e.stopPropagation()
    setDeletingId(boardId)
    setConfirmDeleteId(null)
    try {
      const res = await fetch(`/api/bords/${boardId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      // Optimistic removal
      setBoards(prev => prev.filter(b => b._id !== boardId))
    } catch {
      // Leave board in list if delete failed
    } finally {
      setDeletingId(null)
    }
  }

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    setConfirmDeleteId(null)
  }

  return (
    <div>
      <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
        Boards
      </h1>
      <p className={`text-sm mb-8 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
        {boards.length} board{boards.length !== 1 ? 's' : ''} linked to this organization
      </p>

      {boards.length === 0 ? (
        <div className={`rounded-2xl border p-12 text-center ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <FolderKanban size={40} className={`mx-auto mb-4 ${isDark ? 'text-zinc-600' : 'text-zinc-300'}`} />
          <p className={`text-sm font-medium mb-1 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
            No boards linked yet
          </p>
          <p className={`text-xs ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
            Go to your workspace and use the Collaborate tool to link boards to this organization.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {boards.map((board) => {
            const visibility = visibilityMap[board._id] ?? 'private'
            const isOrgWide = visibility === 'org'
            const isToggling = togglingId === board._id
            const isDeleting = deletingId === board._id
            const isConfirming = confirmDeleteId === board._id
            const canDelete = isOwner || board.ownerId === currentUserId

            return (
              <div
                key={board._id}
                onClick={() => onOpenBoard(board.localBoardId)}
                className={`rounded-2xl border p-5 transition-all hover:shadow-md cursor-pointer ${
                  isDark ? 'bg-zinc-800/50 border-zinc-700/50 hover:border-zinc-600' : 'bg-white border-zinc-200 hover:border-zinc-300'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2 rounded-xl ${isDark ? 'bg-purple-500/15' : 'bg-purple-100'}`}>
                    <FolderKanban size={18} className={isDark ? 'text-purple-400' : 'text-purple-600'} />
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Visibility toggle — only visible to org owner */}
                    {isOwner && (
                      <button
                        onClick={(e) => handleToggleVisibility(e, board._id)}
                        title={isOrgWide ? 'Visible to all org members — click to make private' : 'Private — click to share with all org members'}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                          isOrgWide
                            ? isDark
                              ? 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
                              : 'bg-green-50 text-green-600 hover:bg-green-100'
                            : isDark
                              ? 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700'
                              : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                        }`}
                      >
                        {isToggling ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : isOrgWide ? (
                          <Globe size={12} />
                        ) : (
                          <Lock size={12} />
                        )}
                        {isOrgWide ? 'Org' : 'Private'}
                      </button>
                    )}
                    {/* Visibility badge for non-owners */}
                    {!isOwner && (
                      <span className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs ${
                        isOrgWide
                          ? isDark ? 'text-green-400' : 'text-green-600'
                          : isDark ? 'text-zinc-500' : 'text-zinc-400'
                      }`}>
                        {isOrgWide ? <Globe size={12} /> : <Lock size={12} />}
                      </span>
                    )}
                    <div className={`p-1.5 rounded-lg transition-colors ${
                      isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'
                    }`}>
                      <ExternalLink size={14} />
                    </div>
                    {/* Delete button — org owner or board creator */}
                    {canDelete && (
                      isConfirming ? (
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={(e) => handleConfirmDelete(e, board._id)}
                            className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                              isDark ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-red-50 text-red-600 hover:bg-red-100'
                            }`}
                          >
                            Delete
                          </button>
                          <button
                            onClick={handleCancelDelete}
                            className={`px-2 py-1 rounded-lg text-xs font-medium transition-all ${
                              isDark ? 'bg-zinc-700/50 text-zinc-400 hover:bg-zinc-700' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                            }`}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => handleDeleteClick(e, board._id)}
                          title="Delete board"
                          className={`p-1.5 rounded-lg transition-colors ${
                            isDark ? 'text-zinc-600 hover:text-red-400 hover:bg-red-500/10' : 'text-zinc-300 hover:text-red-500 hover:bg-red-50'
                          }`}
                        >
                          {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        </button>
                      )
                    )}
                  </div>
                </div>
                <h3 className={`font-semibold text-sm mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                  {board.title}
                </h3>
                <div className={`text-xs space-y-1 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  <p>Created {new Date(board.createdAt).toLocaleDateString()}</p>
                  {board.lastPublishedAt && (
                    <p>Last published {formatRelativeTime(board.lastPublishedAt)}</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
