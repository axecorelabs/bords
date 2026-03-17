'use client'

import { FolderKanban, ExternalLink } from 'lucide-react'
import { DashboardData, formatRelativeTime } from './types'

export default function BoardsTab({
  data,
  isDark,
  onOpenBoard,
}: {
  data: DashboardData
  isDark: boolean
  onOpenBoard: (localBoardId: string) => void
}) {
  return (
    <div>
      <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
        Boards
      </h1>
      <p className={`text-sm mb-8 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
        {data.boards.length} board{data.boards.length !== 1 ? 's' : ''} linked to this organization
      </p>

      {data.boards.length === 0 ? (
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
          {data.boards.map((board) => (
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
                <div
                  className={`p-1.5 rounded-lg transition-colors ${
                    isDark ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-400 hover:text-zinc-600'
                  }`}
                >
                  <ExternalLink size={14} />
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
          ))}
        </div>
      )}
    </div>
  )
}
