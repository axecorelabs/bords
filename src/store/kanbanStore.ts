import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { KanbanBoard, KanbanColumn, KanbanTask } from '../types/kanban'
import { useCollabStore } from './collabStore'
import { yjsWriteItem, yjsDeleteItem, YJS_KEYS } from '@/lib/yjs-helpers'
import { throttledStorage } from '@/lib/throttled-storage'
import { useTaskAssignmentMapStore } from './taskAssignmentMapStore'

interface KanbanStore {
  boards: KanbanBoard[]
  addBoard: (board: KanbanBoard) => void
  removeBoard: (id: string) => void
  updateBoardPosition: (id: string, position: { x: number; y: number }) => void
  updateBoardColor: (id: string, color: string) => void
  updateBoardTitle: (id: string, title: string) => void
  updateBoardSize: (id: string, width: number, height: number) => void
  addTask: (boardId: string, columnId: string, task: KanbanTask) => void
  moveTask: (boardId: string, taskId: string, fromColumnId: string, toColumnId: string, newIndex: number) => void
  updateTask: (boardId: string, columnId: string, taskId: string, updates: Partial<KanbanTask>) => void
  deleteTask: (boardId: string, columnId: string, taskId: string) => void
  addColumn: (boardId: string, column: KanbanColumn) => void
  updateColumn: (boardId: string, columnId: string, title: string) => void
  deleteColumn: (boardId: string, columnId: string) => void
}

export const useKanbanStore = create<KanbanStore>()(persist(
  (set) => {
  // Helper: sync a kanban board to Y.Doc after mutation
  const syncBoard = (boards: KanbanBoard[], boardId: string) => {
    const { ydoc } = useCollabStore.getState()
    if (!ydoc) return
    const board = boards.find(b => b.id === boardId)
    if (board) yjsWriteItem(ydoc, YJS_KEYS.KANBANS, boardId, board as any)
  }

  return {
  boards: [],
  
  addBoard: (board) => {
    const { ydoc } = useCollabStore.getState()
    if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.KANBANS, board.id, board as any)
    set((state) => ({ boards: [...state.boards, board] }))
  },
  
  removeBoard: (id) => {
    const { ydoc } = useCollabStore.getState()
    if (ydoc) yjsDeleteItem(ydoc, YJS_KEYS.KANBANS, id)
    set((state) => ({ boards: state.boards.filter((b) => b.id !== id) }))
  },
  
  updateBoardPosition: (id, position) => set((state) => {
    const boards = state.boards.map((b) => b.id === id ? { ...b, position } : b)
    // Send only position for drag — enables debounce in yjsWriteItem
    const { ydoc } = useCollabStore.getState()
    if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.KANBANS, id, { position } as any)
    return { boards }
  }),
  
  updateBoardColor: (id, color) => set((state) => {
    const boards = state.boards.map((b) => b.id === id ? { ...b, color } : b)
    syncBoard(boards, id)
    return { boards }
  }),
  
  updateBoardTitle: (id, title) => set((state) => {
    const boards = state.boards.map((b) => b.id === id ? { ...b, title } : b)
    syncBoard(boards, id)
    return { boards }
  }),
  
  updateBoardSize: (id, width, height) => set((state) => {
    const boards = state.boards.map((b) => b.id === id ? { ...b, width, height } : b)
    const { ydoc } = useCollabStore.getState()
    if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.KANBANS, id, { width, height } as any)
    return { boards }
  }),
  
  addTask: (boardId, columnId, task) => set((state) => {
    const boards = state.boards.map((board) =>
      board.id === boardId
        ? {
            ...board,
            columns: board.columns.map((col) =>
              col.id === columnId
                ? { ...col, tasks: [...col.tasks, task] }
                : col
            )
          }
        : board
    )
    syncBoard(boards, boardId)
    return { boards }
  }),
  
  moveTask: (boardId, taskId, fromColumnId, toColumnId, newIndex) => set((state) => {
    const boards = state.boards.map((board) => {
      if (board.id !== boardId) return board
      
      const fromColumn = board.columns.find((c) => c.id === fromColumnId)
      const task = fromColumn?.tasks.find((t) => t.id === taskId)
      
      if (!task) return board

      // Same column: reorder in place
      if (fromColumnId === toColumnId) {
        return {
          ...board,
          columns: board.columns.map((col) => {
            if (col.id !== fromColumnId) return col
            const tasks = col.tasks.filter((t) => t.id !== taskId)
            tasks.splice(newIndex, 0, task)
            return { ...col, tasks }
          })
        }
      }

      // Different columns: remove from source, insert into target
      return {
        ...board,
        columns: board.columns.map((col) => {
          if (col.id === fromColumnId) {
            return { ...col, tasks: col.tasks.filter((t) => t.id !== taskId) }
          }
          if (col.id === toColumnId) {
            const newTasks = [...col.tasks]
            newTasks.splice(newIndex, 0, task)
            return { ...col, tasks: newTasks }
          }
          return col
        })
      }
    })
    syncBoard(boards, boardId)
    return { boards }
  }),
  
  updateTask: (boardId, columnId, taskId, updates) => set((state) => {
    const boards = state.boards.map((board) =>
      board.id === boardId
        ? {
            ...board,
            columns: board.columns.map((col) =>
              col.id === columnId
                ? {
                    ...col,
                    tasks: col.tasks.map((t) =>
                      t.id === taskId ? { ...t, ...updates } : t
                    )
                  }
                : col
            )
          }
        : board
    )
    syncBoard(boards, boardId)
    // Sync completion status to DB if the completed field changed
    if ('completed' in updates) {
      useTaskAssignmentMapStore.getState().syncCompletionToDb(taskId, !!updates.completed)
    }
    return { boards }
  }),
  
  deleteTask: (boardId, columnId, taskId) => set((state) => {
    const boards = state.boards.map((board) =>
      board.id === boardId
        ? {
            ...board,
            columns: board.columns.map((col) =>
              col.id === columnId
                ? { ...col, tasks: col.tasks.filter((t) => t.id !== taskId) }
                : col
            )
          }
        : board
    )
    syncBoard(boards, boardId)
    return { boards }
  }),
  
  addColumn: (boardId, column) => set((state) => {
    const boards = state.boards.map((board) =>
      board.id === boardId
        ? { ...board, columns: [...board.columns, column] }
        : board
    )
    syncBoard(boards, boardId)
    return { boards }
  }),
  
  updateColumn: (boardId, columnId, title) => set((state) => {
    const boards = state.boards.map((board) =>
      board.id === boardId
        ? {
            ...board,
            columns: board.columns.map((col) =>
              col.id === columnId ? { ...col, title } : col
            )
          }
        : board
    )
    syncBoard(boards, boardId)
    return { boards }
  }),
  
  deleteColumn: (boardId, columnId) => set((state) => {
    const boards = state.boards.map((board) =>
      board.id === boardId
        ? { ...board, columns: board.columns.filter((c) => c.id !== columnId) }
        : board
    )
    syncBoard(boards, boardId)
    return { boards }
  })
}},
  {
    name: 'kanban-storage',
    storage: throttledStorage as any,
  }
))
