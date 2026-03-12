import { create } from 'zustand'
import * as Y from 'yjs'
import type { HocuspocusProvider } from '@hocuspocus/provider'

export interface RemoteUser {
  clientId: number
  user: {
    id: string
    name: string
    email: string
    avatar: string | null
    color: string
    permission?: 'owner' | 'edit' | 'view'
  }
  cursor: { x: number; y: number } | null
  selection: string[]
  editingItem: string | null
  call?: {
    inCall: boolean
    joinedAt: number
  } | null
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface CollabStore {
  // Connection state
  isCollaborating: boolean
  connectionStatus: ConnectionStatus
  ydoc: Y.Doc | null
  provider: HocuspocusProvider | null
  boardId: string | null

  // Remote users (awareness)
  remoteUsers: RemoteUser[]

  // Actions
  setYDoc: (ydoc: Y.Doc, boardId: string) => void
  setYjsState: (ydoc: Y.Doc, provider: HocuspocusProvider, boardId: string) => void
  clearYjsState: () => void
  setConnectionStatus: (status: ConnectionStatus) => void
  setRemoteUsers: (users: RemoteUser[]) => void
}

export const useCollabStore = create<CollabStore>((set, get) => ({
  isCollaborating: false,
  connectionStatus: 'disconnected',
  ydoc: null,
  provider: null,
  boardId: null,

  remoteUsers: [],

  setYDoc: (ydoc, boardId) => set({
    ydoc,
    boardId,
    isCollaborating: false,
    connectionStatus: 'disconnected',
  }),

  setYjsState: (ydoc, provider, boardId) => set({
    ydoc,
    provider,
    boardId,
    isCollaborating: true,
    connectionStatus: 'connecting',
  }),

  clearYjsState: () => {
    const { provider, ydoc } = get()
    provider?.configuration.websocketProvider.disconnect()
    provider?.destroy()
    ydoc?.destroy()
    set({
      ydoc: null,
      provider: null,
      boardId: null,
      isCollaborating: false,
      connectionStatus: 'disconnected',
      remoteUsers: [],
    })
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),

  setRemoteUsers: (users) => set({ remoteUsers: users }),
}))
