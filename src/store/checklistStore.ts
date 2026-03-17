import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useCollabStore } from './collabStore'
import { yjsWriteItem, yjsDeleteItem, YJS_KEYS } from '@/lib/yjs-helpers'
import { throttledStorage } from '@/lib/throttled-storage'
import { useTaskAssignmentMapStore } from './taskAssignmentMapStore'

export const CHECKLIST_COLORS = {
  white: 'bg-white/90',
  gray: 'bg-zinc-100/90',
  yellow: 'bg-yellow-100/90',
  blue: 'bg-blue-100/90',
  green: 'bg-green-100/90',
  pink: 'bg-pink-100/90',
  purple: 'bg-purple-100/90',
  orange: 'bg-orange-100/90'
}

export interface ChecklistItem {
  id: string
  text: string
  completed: boolean
  deadline?: Date
  timeSpent: number // in seconds
  isTracking: boolean
}

export interface Checklist {
  id: string
  title: string
  items: ChecklistItem[]
  position: { x: number; y: number }
  color: string
  createdAt: string
  width?: number
  height?: number
}

interface ChecklistStore {
  checklists: Checklist[]
  addChecklist: (checklist: Omit<Checklist, 'boardId'>) => void
  updateChecklist: (id: string, updates: Partial<Checklist>) => void
  deleteChecklist: (id: string) => void
  toggleItem: (checklistId: string, itemId: string) => void
  updateItem: (checklistId: string, itemId: string, updates: Partial<ChecklistItem>) => void
  toggleTimeTracking: (checklistId: string, itemId: string) => void
  reorderItem: (checklistId: string, fromIndex: number, toIndex: number) => void
}

export const useChecklistStore = create<ChecklistStore>()(
  persist(
    (set, get) => ({
      checklists: [],
      addChecklist: (checklist) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) {
          yjsWriteItem(ydoc, YJS_KEYS.CHECKLISTS, checklist.id, checklist as any)
        }
        set((state) => ({ 
          checklists: [...state.checklists, checklist] 
        }))
      },
      
      updateChecklist: (id, updates) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) {
          // Send only the partial updates — enables position debounce
          yjsWriteItem(ydoc, YJS_KEYS.CHECKLISTS, id, updates as any)
        }
        set((state) => ({
          checklists: state.checklists.map((list) =>
            list.id === id ? { ...list, ...updates } : list
          ),
        }))
      },
      
      deleteChecklist: (id) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) {
          yjsDeleteItem(ydoc, YJS_KEYS.CHECKLISTS, id)
        }
        set((state) => ({
          checklists: state.checklists.filter((list) => list.id !== id),
        }))
      },
      
      toggleItem: (checklistId, itemId) => {
        set((state) => {
          const checklist = state.checklists.find(c => c.id === checklistId)
          const item = checklist?.items.find(i => i.id === itemId)
          const isNowCompleted = item ? !item.completed : false

          const updated = state.checklists.map((list) =>
            list.id === checklistId
              ? {
                  ...list,
                  items: list.items.map((i) =>
                    i.id === itemId
                      ? { ...i, completed: !i.completed }
                      : i
                  ),
                }
              : list
          )
          const { ydoc } = useCollabStore.getState()
          if (ydoc) {
            const cl = updated.find(c => c.id === checklistId)
            if (cl) yjsWriteItem(ydoc, YJS_KEYS.CHECKLISTS, checklistId, cl as any)
          }
          // Sync completion status to DB if this item has a task assignment
          useTaskAssignmentMapStore.getState().syncCompletionToDb(itemId, isNowCompleted)
          return { checklists: updated }
        })
      },
      
      updateItem: (checklistId, itemId, updates) => {
        set((state) => {
          const updated = state.checklists.map((list) =>
            list.id === checklistId
              ? {
                  ...list,
                  items: list.items.map((item) =>
                    item.id === itemId ? { ...item, ...updates } : item
                  ),
                }
              : list
          )
          const { ydoc } = useCollabStore.getState()
          if (ydoc) {
            const cl = updated.find(c => c.id === checklistId)
            if (cl) yjsWriteItem(ydoc, YJS_KEYS.CHECKLISTS, checklistId, cl as any)
          }
          return { checklists: updated }
        })
      },
      
      toggleTimeTracking: (checklistId, itemId) => {
        set((state) => {
          const updated = state.checklists.map((list) =>
            list.id === checklistId
              ? {
                  ...list,
                  items: list.items.map((item) =>
                    item.id === itemId
                      ? {
                          ...item,
                          isTracking: !item.isTracking,
                          timeSpent: item.timeSpent || 0
                        }
                      : item
                  ),
                }
              : list
          )
          const { ydoc } = useCollabStore.getState()
          if (ydoc) {
            const cl = updated.find(c => c.id === checklistId)
            if (cl) yjsWriteItem(ydoc, YJS_KEYS.CHECKLISTS, checklistId, cl as any)
          }
          return { checklists: updated }
        })
      },

      reorderItem: (checklistId, fromIndex, toIndex) => {
        set((state) => {
          const updated = state.checklists.map((list) => {
            if (list.id !== checklistId) return list
            const newItems = [...list.items]
            const [moved] = newItems.splice(fromIndex, 1)
            newItems.splice(toIndex, 0, moved)
            return { ...list, items: newItems }
          })
          const { ydoc } = useCollabStore.getState()
          if (ydoc) {
            const cl = updated.find(c => c.id === checklistId)
            if (cl) yjsWriteItem(ydoc, YJS_KEYS.CHECKLISTS, checklistId, cl as any)
          }
          return { checklists: updated }
        })
      },
    }),
    {
      name: 'checklist-storage',
      storage: throttledStorage as any,
      onRehydrateStorage: () => (state) => {
        // Convert stored date strings back to Date objects
        if (state?.checklists) {
          state.checklists = state.checklists.map(list => ({
            ...list,
            items: list.items.map(item => ({
              ...item,
              deadline: item.deadline ? new Date(item.deadline) : undefined
            }))
          }))
        }
      }
    }
  )
)
