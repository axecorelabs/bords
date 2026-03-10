import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Drawing, DrawingPath } from '@/types/drawing'
import { useCollabStore } from './collabStore'
import { yjsWriteItem, yjsDeleteItem, YJS_KEYS } from '@/lib/yjs-helpers'
import { throttledStorage } from '@/lib/throttled-storage'

interface DrawingStore {
  drawings: Drawing[]
  undoneDrawings: Drawing[]
  isDrawing: boolean
  isErasing: boolean
  isPaused: boolean
  currentColor: string
  currentStrokeWidth: number
  eraserWidth: number
  toggleDrawing: () => void
  toggleEraser: () => void
  togglePause: () => void
  setColor: (color: string) => void
  setStrokeWidth: (width: number) => void
  setEraserWidth: (width: number) => void
  addDrawing: (drawing: Drawing) => void
  updateDrawing: (id: string, paths: DrawingPath[]) => void
  deleteDrawing: (id: string) => void
  moveDrawing: (id: string, position: { x: number; y: number }) => void
  undoLastDrawing: () => void
  redoLastDrawing: () => void
}

export const useDrawingStore = create<DrawingStore>()(
  persist(
    (set) => ({
      drawings: [],
      undoneDrawings: [],
      isDrawing: false,
      isErasing: false,
      isPaused: false,
      currentColor: '#000000',
      currentStrokeWidth: 2,
      eraserWidth: 12,
      
      toggleDrawing: () => set((state) => ({ isDrawing: !state.isDrawing, isErasing: false, isPaused: false })),
      
      toggleEraser: () => set((state) => ({ isErasing: !state.isErasing, isDrawing: true, isPaused: false })),
      
      togglePause: () => set((state) => ({ isPaused: !state.isPaused })),
      
      setColor: (color) => set({ currentColor: color }),
      
      setStrokeWidth: (width) => set({ currentStrokeWidth: width }),
      
      setEraserWidth: (width) => set({ eraserWidth: width }),
      
      addDrawing: (drawing) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.DRAWINGS, drawing.id, drawing as any)
        set((state) => ({ drawings: [...state.drawings, drawing], undoneDrawings: [] }))
      },
      
      updateDrawing: (id, paths) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.DRAWINGS, id, { paths } as any)
        set((state) => ({
          drawings: state.drawings.map((d) =>
            d.id === id ? { ...d, paths } : d
          ),
        }))
      },
      
      deleteDrawing: (id) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) yjsDeleteItem(ydoc, YJS_KEYS.DRAWINGS, id)
        set((state) => ({
          drawings: state.drawings.filter((d) => d.id !== id),
        }))
      },
      
      moveDrawing: (id, position) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.DRAWINGS, id, { position })
        set((state) => ({
          drawings: state.drawings.map((d) =>
            d.id === id ? { ...d, position } : d
          ),
        }))
      },
      
      undoLastDrawing: () =>
        set((state) => {
          if (state.drawings.length === 0) return state
          const last = state.drawings[state.drawings.length - 1]
          return {
            drawings: state.drawings.slice(0, -1),
            undoneDrawings: [...state.undoneDrawings, last],
          }
        }),

      redoLastDrawing: () =>
        set((state) => {
          if (state.undoneDrawings.length === 0) return state
          const last = state.undoneDrawings[state.undoneDrawings.length - 1]
          return {
            drawings: [...state.drawings, last],
            undoneDrawings: state.undoneDrawings.slice(0, -1),
          }
        }),
    }),
    {
      name: 'drawing-storage',
      storage: throttledStorage as any,
      // Don't persist undo history — it can grow large and is session-only
      partialize: (state) => {
        const { undoneDrawings, ...rest } = state
        return rest
      },
    }
  )
)
