'use client'

import { FolderKanban, ExternalLink } from 'lucide-react'
import { PersonalDashboardData, formatRelativeTime } from './types'

export default function PersonalBoardsTab({
  data,
  isDark,
  onOpenBoard,
}: {
  data: PersonalDashboardData
  isDark: boolean
  onOpenBoard: (localBoardId: string) => void
}) {
  return (
    <div>
      <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Boards</h1>
      <p className={`text-sm mb-8 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
        {data.boards.length} personal board{data.boards.length !== 1 ? 's' : ''}
      </p>

      {data.boards.length === 0 ? (
        <div className={`rounded-2xl border p-12 text-center ${
          isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
        }`}>
          <FolderKanban size={40} className={`mx-auto mb-4 ${isDark ? 'text-zinc-600' : 'text-zinc-300'}`} />
          <p className={`text-sm font-medium ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
            No personal boards yet
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.boards.map((board) => (
            <div
              key={board._id}
              onClick={() => onOpenBoard(board.localBoardId)}
              className={`rounded-2xl border p-5 transition-colors cursor-pointer ${
                isDark
                  ? 'bg-zinc-800/50 border-zinc-700/50 hover:bg-zinc-800/80'
                  : 'bg-white border-zinc-200 hover:bg-zinc-50'
              }`}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-50 text-blue-500'
                }`}>
                  <FolderKanban size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold truncate ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                    {board.title || 'Untitled'}
                  </p>
                  <p className={`text-xs mt-0.5 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                    Updated {formatRelativeTime(board.updatedAt)}
                  </p>
                </div>
                <ExternalLink size={14} className={isDark ? 'text-zinc-600' : 'text-zinc-400'} />
              </div>
              <p className={`text-[11px] ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`}>
                Created {new Date(board.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
