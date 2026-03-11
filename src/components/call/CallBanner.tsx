'use client'

import { Phone } from 'lucide-react'
import { useCallStore } from '@/store/callStore'
import { useBoardStore } from '@/store/boardStore'
import { useCollabStore } from '@/store/collabStore'

export function CallBanner() {
  const { isInCall, startCall } = useCallStore()
  const currentBoardId = useBoardStore((s) => s.currentBoardId)
  const remoteUsers = useCollabStore((s) => s.remoteUsers) || []

  // Count remote users in a call
  const remoteCallUsers = (remoteUsers || []).filter(
    (u: any) => u.call?.inCall
  )

  // Only show when there's an active call and user is NOT in it
  if (isInCall || remoteCallUsers.length === 0 || !currentBoardId) return null

  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[55]">
      <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-zinc-900/90 backdrop-blur-xl border border-zinc-700/50 shadow-2xl">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
        </span>

        {/* Avatar stack */}
        <div className="flex -space-x-2">
          {remoteCallUsers.slice(0, 4).map((u) => {
            const initial = (u.user.name || u.user.email || '?')[0].toUpperCase()
            return (
              <img
                key={u.clientId}
                src={u.user.avatar || `https://placehold.co/28x28/27272a/fff?text=${initial}`}
                alt={u.user.name || ''}
                className="w-7 h-7 rounded-full border-2 border-zinc-900 object-cover"
              />
            )
          })}
          {remoteCallUsers.length > 4 && (
            <div className="w-7 h-7 rounded-full border-2 border-zinc-900 bg-zinc-700 flex items-center justify-center text-[10px] font-bold text-white">
              +{remoteCallUsers.length - 4}
            </div>
          )}
        </div>

        <span className="text-sm text-zinc-300">
          Call in progress · {remoteCallUsers.length} participant{remoteCallUsers.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => startCall(currentBoardId)}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors"
        >
          <Phone size={14} />
          Join
        </button>
      </div>
    </div>
  )
}
