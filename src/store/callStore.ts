import { create } from 'zustand'
import { useCollabStore } from './collabStore'

export interface CallParticipant {
  userId: string
  name: string
  avatar: string | null
  joinedAt: number
}

interface CallStore {
  // State
  isInCall: boolean
  callBoardId: string | null
  livekitToken: string | null
  livekitUrl: string

  // Media state
  isMicEnabled: boolean
  isCameraEnabled: boolean
  isScreenSharing: boolean

  // UI state
  isCallPanelOpen: boolean
  activeSpeakerId: string | null

  // Loading / error
  isJoining: boolean
  error: string | null

  // Actions
  startCall: (boardId: string) => Promise<void>
  joinCall: (boardId: string) => Promise<void>
  leaveCall: () => void
  toggleMic: () => void
  toggleCamera: () => void
  toggleScreenShare: () => void
  setActiveSpeaker: (userId: string | null) => void
  setCallPanelOpen: (open: boolean) => void
  setMicEnabled: (enabled: boolean) => void
  setCameraEnabled: (enabled: boolean) => void
  setScreenSharing: (sharing: boolean) => void
}

export const useCallStore = create<CallStore>((set, get) => ({
  isInCall: false,
  callBoardId: null,
  livekitToken: null,
  livekitUrl: process.env.NEXT_PUBLIC_LIVEKIT_URL || '',

  isMicEnabled: true,
  isCameraEnabled: false,
  isScreenSharing: false,

  isCallPanelOpen: true,
  activeSpeakerId: null,

  isJoining: false,
  error: null,

  startCall: async (boardId: string) => {
    if (get().isJoining || get().isInCall) return
    set({ isJoining: true, error: null })

    try {
      const res = await fetch('/api/calls/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boardId }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to start call')
      }

      const { token, url, room } = await res.json()

      set({
        isInCall: true,
        callBoardId: boardId,
        livekitToken: token,
        livekitUrl: url,
        isJoining: false,
        isCallPanelOpen: true,
        isMicEnabled: true,
        isCameraEnabled: false,
      })

      // Broadcast call state via awareness
      const { provider } = useCollabStore.getState()
      if (provider?.awareness) {
        provider.awareness.setLocalStateField('call', {
          inCall: true,
          joinedAt: Date.now(),
        })
      }
    } catch (err: any) {
      set({ isJoining: false, error: err.message || 'Failed to start call' })
    }
  },

  joinCall: async (boardId: string) => {
    // Same flow as startCall — backend returns token for existing room
    return get().startCall(boardId)
  },

  leaveCall: () => {
    // Broadcast leaving via awareness
    const { provider } = useCollabStore.getState()
    if (provider?.awareness) {
      provider.awareness.setLocalStateField('call', null)
    }

    set({
      isInCall: false,
      callBoardId: null,
      livekitToken: null,
      isMicEnabled: true,
      isCameraEnabled: false,
      isScreenSharing: false,
      isCallPanelOpen: true,
      activeSpeakerId: null,
      isJoining: false,
      error: null,
    })
  },

  toggleMic: () => set((s) => ({ isMicEnabled: !s.isMicEnabled })),
  toggleCamera: () => set((s) => ({ isCameraEnabled: !s.isCameraEnabled })),
  toggleScreenShare: () => set((s) => ({ isScreenSharing: !s.isScreenSharing })),
  setActiveSpeaker: (userId) => set({ activeSpeakerId: userId }),
  setCallPanelOpen: (open) => set({ isCallPanelOpen: open }),
  setMicEnabled: (enabled) => set({ isMicEnabled: enabled }),
  setCameraEnabled: (enabled) => set({ isCameraEnabled: enabled }),
  setScreenSharing: (sharing) => set({ isScreenSharing: sharing }),
}))
