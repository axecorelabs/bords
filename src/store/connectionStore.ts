import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const CONNECTION_COLORS = [
  'rgba(59, 130, 246, 0.6)', // bright blue
  'rgba(16, 185, 129, 0.6)', // bright green
  'rgba(236, 72, 153, 0.6)', // bright pink
  'rgba(249, 115, 22, 0.6)', // bright orange
  'rgba(168, 85, 247, 0.6)', // bright purple
  'rgba(234, 179, 8, 0.6)',  // bright yellow
  'rgba(239, 68, 68, 0.6)',  // bright red
  'rgba(20, 184, 166, 0.6)', // bright teal
] as const

export type ConnectionItemType = 'note' | 'checklist' | 'kanban' | 'text' | 'media' | 'reminder' | 'table'

export interface Connection {
  id: string
  fromId: string
  toId: string
  fromType: ConnectionItemType
  toType: ConnectionItemType
  fromPosition?: { x: number; y: number }
  toPosition?: { x: number; y: number }
  color: string
  boardId: string
}

interface DraggedNode {
  id: string
  type: ConnectionItemType
  side: 'left' | 'right'
  position: { x: number; y: number }
  sourceNodeRef: HTMLElement | null
  boardId: string
}

interface ConnectionStore {
  selectedItems: {
    id: string
    type: ConnectionItemType
    position: { x: number; y: number }
  }[]
  connections: Connection[]
  selectItem: (id: string, type: ConnectionItemType, position: { x: number; y: number }) => void
  deselectItem: (id: string) => void
  clearSelection: () => void
  addConnection: (fromId: string, toId: string, fromType: ConnectionItemType, toType: ConnectionItemType, positions: { from: { x: number; y: number }, to: { x: number; y: number } }, boardId: string) => void
  removeConnection: (id: string) => void
  removeConnectionsByItemId: (itemId: string) => void
  clearAllConnections: () => void
  draggedNode: DraggedNode | null
  setDraggedNode: (node: DraggedNode | null) => void
  updateConnectionPositions: (connections: Connection[]) => void
  isVisible: boolean
  toggleVisibility: () => void
  updateConnectionBoard: (connectionId: string, boardId: string) => void
  clearBoardConnections: (boardId: string) => void
}

export const useConnectionStore = create<ConnectionStore>()(
  persist(
    (set) => ({
      selectedItems: [],
      connections: [],
      selectItem: (id, type, position) =>
        set((state) => ({
          selectedItems: state.selectedItems.length < 2 
            ? [...state.selectedItems, { id, type, position }]
            : [{ id, type, position }]
        })),
      deselectItem: (id) =>
        set((state) => ({
          selectedItems: state.selectedItems.filter(item => item.id !== id)
        })),
      clearSelection: () =>
        set({ selectedItems: [] }),
      addConnection: (fromId, toId, fromType, toType, positions, boardId) => {
        set((state) => {
          // Check if connection already exists (bidirectional)
          const exists = state.connections.some(
            conn => 
              (conn.fromId === fromId && conn.toId === toId) ||
              (conn.fromId === toId && conn.toId === fromId)
          )
          
          if (exists) {
            console.warn('Connection already exists between these items')
            return { selectedItems: [] }
          }
          
          const color = CONNECTION_COLORS[Math.floor(Math.random() * CONNECTION_COLORS.length)]
          return {
            connections: [...state.connections, {
              id: Date.now().toString(),
              fromId,
              toId,
              fromType,
              toType,
              fromPosition: positions.from,
              toPosition: positions.to,
              color,
              boardId
            }],
            selectedItems: [] // Clear selection after connection
          }
        })
      },
      removeConnection: (id) =>
        set((state) => ({
          connections: state.connections.filter(conn => conn.id !== id)
        })),
      removeConnectionsByItemId: (itemId) =>
        set((state) => ({
          connections: state.connections.filter(
            conn => conn.fromId !== itemId && conn.toId !== itemId
          )
        })),
      clearAllConnections: () => set({ connections: [], selectedItems: [] }),
      draggedNode: null,
      setDraggedNode: (node) => set({ draggedNode: node }),
      updateConnectionPositions: (connections) => set({ connections }),
      isVisible: true,
      toggleVisibility: () => set(state => ({ isVisible: !state.isVisible })),
      updateConnectionBoard: (connectionId, boardId) =>
        set((state) => ({
          connections: state.connections.map(conn =>
            conn.id === connectionId ? { ...conn, boardId } : conn
          )
        })),
      clearBoardConnections: (boardId) =>
        set((state) => ({
          connections: state.connections.filter(conn => conn.boardId !== boardId),
          selectedItems: []
        })),
    }),
    {
      name: 'connection-storage'
    }
  )
)
