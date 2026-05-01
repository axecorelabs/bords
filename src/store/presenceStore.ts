'use client'
import { create } from 'zustand'
import { messagingSocket } from '@/lib/messaging-socket'

/**
 * presenceStore — tracks which user IDs are currently online.
 *
 * Populated by presence_update events from the collab-server messaging WS.
 * The socket singleton fires these events when any user connects or disconnects.
 *
 * Usage:
 *   const isOnline = usePresenceStore((s) => s.isOnline)
 *   isOnline(userId)  // → boolean
 */

interface PresenceState {
  onlineUsers: Set<string>
  /** Start listening to presence events from the socket. Returns cleanup fn. */
  subscribe: () => () => void
}

export const usePresenceStore = create<PresenceState>((set) => ({
  onlineUsers: new Set(),

  subscribe: () => {
    const off = messagingSocket.on((event) => {
      if (event.type !== 'presence_update') return
      set((state) => {
        const next = new Set(state.onlineUsers)
        if (event.online) {
          next.add(event.userId)
        } else {
          next.delete(event.userId)
        }
        return { onlineUsers: next }
      })
    })
    return off
  },
}))
