'use client'

import { Phone, PhoneCall, Loader2 } from 'lucide-react'
import { useCallStore } from '@/store/callStore'
import { useBoardStore } from '@/store/boardStore'
import { useCollabStore } from '@/store/collabStore'
import { useThemeStore } from '@/store/themeStore'
import { useBoardSyncStore } from '@/store/boardSyncStore'

export function CallButton() {
  const { isDark } = useThemeStore()
  const currentBoardId = useBoardStore((s) => s.currentBoardId)
  const { isInCall, isJoining, startCall, setCallPanelOpen } = useCallStore()
  const remoteUsers = useCollabStore((s) => s.remoteUsers) || []
  const boardPermission = useBoardSyncStore(
    (s) => s.boardPermissions[currentBoardId || ''] || 'owner'
  )

  // Count remote users who are in a call on this board
  const remoteCallUsers = (remoteUsers || []).filter(
    (u: any) => u.call?.inCall
  )
  const callActive = remoteCallUsers.length > 0 || isInCall
  const participantCount = remoteCallUsers.length + (isInCall ? 1 : 0)

  if (!currentBoardId) return null

  // Already in call — clicking opens the panel
  if (isInCall) {
    return (
      <button
        onClick={() => setCallPanelOpen(true)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors
          bg-green-500/20 text-green-500 hover:bg-green-500/30`}
        title="In call — click to show"
      >
        <PhoneCall size={16} />
        <span className="text-xs font-semibold">{participantCount}</span>
      </button>
    )
  }

  // Call active on board but user not in it — show join button
  if (callActive && !isInCall) {
    return (
      <button
        onClick={() => startCall(currentBoardId)}
        disabled={isJoining}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors
          bg-green-500/20 text-green-500 hover:bg-green-500/30
          ${isJoining ? 'opacity-60 cursor-not-allowed' : ''}`}
        title={`Join call (${participantCount} in call)`}
      >
        {isJoining ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-xs font-semibold">Join ({participantCount})</span>
          </>
        )}
      </button>
    )
  }

  // No active call — show start button
  return (
    <button
      onClick={() => startCall(currentBoardId)}
      disabled={isJoining || boardPermission === 'view'}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg transition-colors
        ${isDark
          ? 'hover:bg-zinc-700/50 text-zinc-400 hover:text-zinc-200'
          : 'hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900'}
        ${isJoining || boardPermission === 'view' ? 'opacity-40 cursor-not-allowed' : ''}`}
      title={boardPermission === 'view' ? 'Viewers cannot start calls' : 'Start a call'}
    >
      {isJoining ? (
        <Loader2 size={16} className="animate-spin" />
      ) : (
        <Phone size={16} />
      )}
    </button>
  )
}
