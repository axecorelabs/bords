import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useCollabStore } from './collabStore'
import { yjsWriteBoardMeta, YJS_KEYS } from '@/lib/yjs-helpers'
import { throttledStorage } from '@/lib/throttled-storage'

export interface Board {
  id: string
  userId: string // Owner's user ID for security
  name: string
  createdAt: Date
  lastModified: Date
  notes: string[] // IDs of notes
  checklists: string[] // IDs of checklists
  texts: string[] // IDs of texts
  connections: string[] // IDs of connections
  drawings: string[] // IDs of drawings
  kanbans: string[] // IDs of kanban boards
  medias: string[] // IDs of media items
  reminders: string[] // IDs of reminders
  tables: string[] // IDs of tables
  contextType?: 'personal' | 'organization' // Workspace context
  organizationId?: string // Organization ID if contextType is 'organization'
  backgroundImage?: string // Data URL of background image
  backgroundColor?: string // Solid background color
  backgroundOverlay?: boolean // Semi-transparent blur overlay
  backgroundOverlayColor?: string // Custom overlay color
  backgroundBlurLevel?: 'sm' | 'md' | 'lg' | 'xl' // Blur intensity level
}

interface BoardStore {
  boards: Board[]
  currentBoardId: string | null
  currentUserId: string | null
  isBoardsPanelOpen: boolean
  isBackgroundModalOpen: boolean
  setCurrentUserId: (userId: string | null) => void
  addBoard: (name: string, userId: string, context?: { contextType: 'personal' | 'organization'; organizationId?: string }) => void
  deleteBoard: (id: string) => void
  updateBoard: (id: string, updates: Partial<Board>) => void
  setCurrentBoard: (id: string) => void
  toggleBoardsPanel: () => void
  setBoardsPanelOpen: (open: boolean) => void
  addItemToBoard: (boardId: string, itemType: 'notes' | 'checklists' | 'texts' | 'connections' | 'drawings' | 'kanbans' | 'medias' | 'reminders' | 'tables', itemId: string) => void
  removeItemFromBoard: (boardId: string, itemType: 'notes' | 'checklists' | 'texts' | 'connections' | 'drawings' | 'kanbans' | 'medias' | 'reminders' | 'tables', itemId: string) => void
  addMediaToBoard: (boardId: string, mediaId: string) => void
  updateBoardBackground: (boardId: string, backgroundImage: string | undefined) => void
  updateBoardBackgroundColor: (boardId: string, backgroundColor: string | undefined) => void
  updateBoardOverlay: (boardId: string, overlay: boolean) => void
  updateBoardOverlayColor: (boardId: string, overlayColor: string | undefined) => void
  updateBoardBlurLevel: (boardId: string, blurLevel: 'sm' | 'md' | 'lg' | 'xl') => void
  openBackgroundModal: () => void
  closeBackgroundModal: () => void
  getUserBoards: () => Board[]
  clearUserData: () => void
  /** Bumped by applyCloudData — TldrawCanvas watches this to reload shapes */
  boardDataVersion: number
  bumpBoardDataVersion: () => void
}

export const useBoardStore = create<BoardStore>()(
  persist(
    (set, get) => ({
      boards: [],
      currentBoardId: null,
      currentUserId: null,
      isBoardsPanelOpen: false,
      isBackgroundModalOpen: false,
      boardDataVersion: 0,
      bumpBoardDataVersion: () => set((s) => ({ boardDataVersion: s.boardDataVersion + 1 })),
      setCurrentUserId: (userId) => set({ currentUserId: userId }),
      addBoard: (name, userId, context) => {
        const newBoardId = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
        set((state) => {
          const userBoards = state.boards.filter(b => b.userId === userId)
          return {
            boards: [...state.boards, {
              id: newBoardId,
              userId,
              name,
              createdAt: new Date(),
              lastModified: new Date(),
              notes: [],
              checklists: [],
              texts: [],
              connections: [],
              drawings: [],
              kanbans: [],
              medias: [],
              reminders: [],
              tables: [],
              ...(context?.contextType && { contextType: context.contextType }),
              ...(context?.organizationId && { organizationId: context.organizationId }),
            }],
            currentBoardId: userBoards.length === 0 ? newBoardId : state.currentBoardId
          }
        })
        if (get().currentBoardId === newBoardId) {
          try { localStorage.setItem('bords-last-board', newBoardId) } catch {}
        }

        // Create Bord + BoardDocument entries in the database (fire-and-forget)
        fetch('/api/boards/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            localBoardId: newBoardId,
            name,
            contextType: context?.contextType || 'personal',
            organizationId: context?.organizationId || null,
          }),
        }).catch(() => {})
      },
      deleteBoard: (id) => set((state) => {
        const boardToDelete = state.boards.find(board => board.id === id)
        
        if (boardToDelete) {
          // Get all item IDs from the board
          const noteIds = boardToDelete.notes
          const checklistIds = boardToDelete.checklists
          const textIds = boardToDelete.texts
          const kanbanIds = boardToDelete.kanbans
          const mediaIds = boardToDelete.medias
          const drawingIds = boardToDelete.drawings
          
          // Store the items to delete
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('boardDeleted', { 
              detail: { 
                boardId: id,
                noteIds,
                checklistIds,
                textIds,
                kanbanIds,
                mediaIds,
                drawingIds
              } 
            }))
          }
        }

        const remaining = state.boards.filter((board) => board.id !== id)

        // Pick a replacement board from the SAME workspace context
        let nextBoardId: string | null = null
        if (state.currentBoardId === id && remaining.length > 0 && boardToDelete) {
          const sameContext = remaining.filter(b => {
            if (boardToDelete.contextType === 'organization') {
              return b.contextType === 'organization' && b.organizationId === boardToDelete.organizationId
            }
            return !b.contextType || b.contextType === 'personal'
          })
          nextBoardId = sameContext.length > 0 ? sameContext[0].id : null
        } else {
          nextBoardId = state.currentBoardId === id ? null : state.currentBoardId
        }
        
        return {
          boards: remaining,
          currentBoardId: nextBoardId
        }
      }),
      updateBoard: (id, updates) => {
        const { ydoc, boardId } = useCollabStore.getState()
        if (ydoc && id === boardId) {
          for (const [k, v] of Object.entries(updates)) yjsWriteBoardMeta(ydoc, k, v)
        }
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id === id ? { ...board, ...updates, lastModified: new Date() } : board
          )
        }))
      },
      setCurrentBoard: (id) => {
        try { localStorage.setItem('bords-last-board', id) } catch {}
        set({ currentBoardId: id })
      },
      toggleBoardsPanel: () => set((state) => ({ isBoardsPanelOpen: !state.isBoardsPanelOpen })),
      setBoardsPanelOpen: (open) => set({ isBoardsPanelOpen: open }),
      addItemToBoard: (boardId, itemType, itemId) =>
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id === boardId
              ? { ...board, [itemType]: [...(board[itemType] || []), itemId] }
              : board
          )
        })),
      removeItemFromBoard: (boardId, itemType, itemId) =>
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id === boardId
              ? { ...board, [itemType]: (board[itemType] || []).filter(id => id !== itemId) }
              : board
          )
        })),
      addMediaToBoard: (boardId, mediaId) =>
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id === boardId
              ? { ...board, medias: [...(board.medias || []), mediaId] }
              : board
          )
        })),
      updateBoardBackground: (boardId, backgroundImage) => {
        const { ydoc, boardId: collabBoardId } = useCollabStore.getState()
        if (ydoc && boardId === collabBoardId) yjsWriteBoardMeta(ydoc, 'backgroundImage', backgroundImage)
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id === boardId
              ? { ...board, backgroundImage, lastModified: new Date() }
              : board
          )
        }))
      },
      updateBoardBackgroundColor: (boardId, backgroundColor) => {
        const { ydoc, boardId: collabBoardId } = useCollabStore.getState()
        if (ydoc && boardId === collabBoardId) yjsWriteBoardMeta(ydoc, 'backgroundColor', backgroundColor)
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id === boardId
              ? { ...board, backgroundColor, lastModified: new Date() }
              : board
          )
        }))
      },
      updateBoardOverlay: (boardId, overlay) => {
        const { ydoc, boardId: collabBoardId } = useCollabStore.getState()
        if (ydoc && boardId === collabBoardId) yjsWriteBoardMeta(ydoc, 'backgroundOverlay', overlay)
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id === boardId
              ? { ...board, backgroundOverlay: overlay, lastModified: new Date() }
              : board
          )
        }))
      },
      updateBoardOverlayColor: (boardId, overlayColor) => {
        const { ydoc, boardId: collabBoardId } = useCollabStore.getState()
        if (ydoc && boardId === collabBoardId) yjsWriteBoardMeta(ydoc, 'backgroundOverlayColor', overlayColor)
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id === boardId
              ? { ...board, backgroundOverlayColor: overlayColor, lastModified: new Date() }
              : board
          )
        }))
      },
      updateBoardBlurLevel: (boardId, blurLevel) => {
        const { ydoc, boardId: collabBoardId } = useCollabStore.getState()
        if (ydoc && boardId === collabBoardId) yjsWriteBoardMeta(ydoc, 'backgroundBlurLevel', blurLevel)
        set((state) => ({
          boards: state.boards.map((board) =>
            board.id === boardId
              ? { ...board, backgroundBlurLevel: blurLevel, lastModified: new Date() }
              : board
          )
        }))
      },
      openBackgroundModal: () => set({ isBackgroundModalOpen: true }),
      closeBackgroundModal: () => set({ isBackgroundModalOpen: false }),
      getUserBoards: () => {
        const state = get()
        return state.boards.filter(b => b.userId === state.currentUserId)
      },
      clearUserData: () => set({ 
        currentBoardId: null, 
        currentUserId: null,
        isBoardsPanelOpen: false,
        isBackgroundModalOpen: false 
      })
    }),
    {
      name: 'board-storage',
      storage: throttledStorage as any,
    }
  )
)
