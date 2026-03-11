'use client'

import { Mic, MicOff } from 'lucide-react'
import type { Participant } from 'livekit-client'
import { Track } from 'livekit-client'
import {
  useParticipantTile,
  VideoTrack,
  AudioTrack,
  useIsSpeaking,
  useTracks,
} from '@livekit/components-react'

interface ParticipantTileProps {
  participant: Participant
}

export function ParticipantTile({ participant }: ParticipantTileProps) {
  const isSpeaking = useIsSpeaking(participant)
  const isMuted = !participant.isMicrophoneEnabled
  const isCameraOn = participant.isCameraEnabled

  // Parse metadata for avatar
  let avatar: string | null = null
  try {
    const meta = JSON.parse(participant.metadata || '{}')
    avatar = meta.avatar || null
  } catch {}

  const initials = (participant.name || participant.identity || '?')
    .split(' ')
    .map((s) => s[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div
      className={`relative rounded-xl overflow-hidden bg-zinc-800 flex items-center justify-center aspect-video
        ${isSpeaking ? 'ring-2 ring-green-500 ring-offset-1 ring-offset-zinc-900' : ''}`}
    >
      {/* Video track or avatar placeholder */}
      {isCameraOn && participant.getTrackPublication(Track.Source.Camera) ? (
        <VideoTrack
          trackRef={{
            participant,
            publication: participant.getTrackPublication(Track.Source.Camera)!,
            source: Track.Source.Camera,
          }}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="flex items-center justify-center w-full h-full">
          <img
            src={avatar || `https://placehold.co/64x64/52525b/fff?text=${initials}`}
            alt={participant.name || ''}
            className="w-16 h-16 rounded-full object-cover"
          />
        </div>
      )}

      {/* Name label */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded-md px-2 py-1">
        <span className="text-xs text-white font-medium truncate max-w-[120px]">
          {participant.name || participant.identity}
          {participant.isLocal && ' (You)'}
        </span>
      </div>

      {/* Muted indicator */}
      {isMuted && (
        <div className="absolute bottom-2 right-2 p-1 rounded-full bg-red-500/80">
          <MicOff size={12} className="text-white" />
        </div>
      )}
    </div>
  )
}
