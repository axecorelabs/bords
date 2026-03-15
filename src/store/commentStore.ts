import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** Shape returned from the board_comments table */
export interface Comment {
  id: string
  board_id: string
  owner_id: string
  user_id: string
  user_name: string
  user_avatar: string | null
  text: string
  item_id: string | null
  parent_id: string | null
  mentions: any[]
  created_at: string
}

/** Lightweight local-only comment for non-synced boards */
export interface LocalComment {
  id: string
  text: string
  createdAt: Date
  position: { x: number; y: number }
  boardId: string
  authorId?: string
  authorName?: string
  authorEmail?: string
}

interface CommentStore {
  // Local-only comments (for boards not synced to server)
  localComments: LocalComment[]
  isCommenting: boolean

  // Total comment counts per board (from Realtime)
  realtimeCounts: Record<string, number>
  // Unread comment counts per board (total - read)
  unreadCounts: Record<string, number>

  addLocalComment: (text: string, boardId: string, author?: { id: string; name: string; email: string }) => void
  deleteLocalComment: (id: string) => void
  toggleCommenting: () => void
  setCommenting: (value: boolean) => void
  setRealtimeCount: (boardId: string, count: number) => void
  setUnreadCount: (boardId: string, count: number) => void
  incrementUnread: (boardId: string) => void
  markRead: (boardId: string) => void
}

export const useCommentStore = create<CommentStore>()(
  persist(
    (set) => ({
      localComments: [],
      isCommenting: false,
      realtimeCounts: {},
      unreadCounts: {},

      addLocalComment: (text, boardId, author) =>
        set((state) => ({
          localComments: [...state.localComments, {
            id: Date.now().toString(),
            text,
            createdAt: new Date(),
            position: { x: 0, y: 0 },
            boardId,
            authorId: author?.id,
            authorName: author?.name,
            authorEmail: author?.email,
          }]
        })),

      deleteLocalComment: (id) =>
        set((state) => ({
          localComments: state.localComments.filter(c => c.id !== id)
        })),

      toggleCommenting: () =>
        set((state) => ({ isCommenting: !state.isCommenting })),

      setCommenting: (value) => set({ isCommenting: value }),

      setRealtimeCount: (boardId, count) =>
        set((state) => ({
          realtimeCounts: { ...state.realtimeCounts, [boardId]: count },
        })),

      setUnreadCount: (boardId, count) =>
        set((state) => ({
          unreadCounts: { ...state.unreadCounts, [boardId]: count },
        })),

      incrementUnread: (boardId) =>
        set((state) => ({
          unreadCounts: {
            ...state.unreadCounts,
            [boardId]: (state.unreadCounts[boardId] ?? 0) + 1,
          },
        })),

      markRead: (boardId) =>
        set((state) => ({
          unreadCounts: { ...state.unreadCounts, [boardId]: 0 },
        })),
    }),
    {
      name: 'comment-storage',
      partialize: (state) => ({
        localComments: state.localComments,
        isCommenting: state.isCommenting,
      }),
    }
  )
)
