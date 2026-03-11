'use client'

import { useParticipants } from '@livekit/components-react'
import { ParticipantTile } from './ParticipantTile'

export function ParticipantGrid() {
  const participants = useParticipants()

  const count = participants.length

  // Dynamic grid layout
  const gridClass =
    count <= 1
      ? 'grid-cols-1'
      : count <= 4
        ? 'grid-cols-2'
        : 'grid-cols-3'

  return (
    <div className={`grid ${gridClass} gap-1.5 p-1.5 flex-1 overflow-y-auto`}>
      {participants.map((p) => (
        <ParticipantTile key={p.identity} participant={p} />
      ))}
    </div>
  )
}
