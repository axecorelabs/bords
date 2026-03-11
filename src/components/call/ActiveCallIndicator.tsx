'use client'

import { useCallStore } from '@/store/callStore'
import { useCollabStore } from '@/store/collabStore'

export function ActiveCallIndicator() {
  const isInCall = useCallStore((s) => s.isInCall)
  const remoteUsers = useCollabStore((s) => s.remoteUsers)

  const remoteCallUsers = remoteUsers.filter(
    (u: any) => u.call?.inCall
  )
  const callActive = remoteCallUsers.length > 0 || isInCall

  if (!callActive) return null

  return (
    <span className="relative flex h-2 w-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
    </span>
  )
}
