'use client'

import { Mic, MicOff, Video, VideoOff, Monitor, PhoneOff } from 'lucide-react'
import { useCallStore } from '@/store/callStore'

interface CallControlsProps {
  compact?: boolean
}

export function CallControls({ compact }: CallControlsProps) {
  const {
    isMicEnabled,
    isCameraEnabled,
    isScreenSharing,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    leaveCall,
  } = useCallStore()

  const btnSize = compact ? 'p-1.5' : 'p-2.5'
  const iconSize = compact ? 14 : 18

  return (
    <div className={`flex items-center justify-center ${compact ? 'gap-1' : 'gap-2 px-3 py-2'}`}>
      {/* Microphone */}
      <button
        onClick={toggleMic}
        className={`${btnSize} rounded-full transition-colors
          ${isMicEnabled
            ? 'bg-zinc-700 hover:bg-zinc-600 text-white'
            : 'bg-red-500 hover:bg-red-600 text-white'}`}
        title={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
      >
        {isMicEnabled ? <Mic size={iconSize} /> : <MicOff size={iconSize} />}
      </button>

      {/* Camera */}
      <button
        onClick={toggleCamera}
        className={`${btnSize} rounded-full transition-colors
          ${isCameraEnabled
            ? 'bg-zinc-700 hover:bg-zinc-600 text-white'
            : 'bg-red-500 hover:bg-red-600 text-white'}`}
        title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}
      >
        {isCameraEnabled ? <Video size={iconSize} /> : <VideoOff size={iconSize} />}
      </button>

      {/* Screen Share */}
      {!compact && (
        <button
          onClick={toggleScreenShare}
          className={`${btnSize} rounded-full transition-colors
            ${isScreenSharing
              ? 'bg-blue-500 hover:bg-blue-600 text-white'
              : 'bg-zinc-700 hover:bg-zinc-600 text-white'}`}
          title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
        >
          <Monitor size={iconSize} />
        </button>
      )}

      {/* Leave */}
      <button
        onClick={leaveCall}
        className={`${btnSize} rounded-full bg-red-600 hover:bg-red-700 text-white transition-colors ${compact ? 'ml-1' : 'ml-2'}`}
        title="Leave call"
      >
        <PhoneOff size={iconSize} />
      </button>
    </div>
  )
}
