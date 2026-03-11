import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useCollabStore } from './collabStore'
import { yjsWriteItem, yjsDeleteItem, YJS_KEYS } from '@/lib/yjs-helpers'
import { throttledStorage } from '@/lib/throttled-storage'

export interface StickyNote {
  id: string
  text: string
  position: { x: number; y: number }
  color: string
  width?: number
  height?: number
}

interface StickyNoteStore {
  notes: StickyNote[]
  addNote: (note: StickyNote) => void
  updateNote: (id: string, updates: Partial<StickyNote>) => void
  deleteNote: (id: string) => void
}

export const STICKY_COLORS = {
  yellow: 'bg-yellow-200',
  blue: 'bg-blue-200',
  green: 'bg-green-200',
  pink: 'bg-pink-200',
  purple: 'bg-purple-200',
}

export const useNoteStore = create(
  persist<StickyNoteStore>(
    (set) => ({
      notes: [],
      addNote: (note) => {
        const { ydoc } = useCollabStore.getState()
        console.log('[StickyNoteStore] addNote — ydoc is:', ydoc ? 'SET' : 'NULL')
        if (ydoc) {
          yjsWriteItem(ydoc, YJS_KEYS.STICKY_NOTES, note.id, note)
          console.log('[StickyNoteStore] Wrote note to Y.Doc:', note.id)
        } else {
          console.warn('[StickyNoteStore] ydoc is NULL — note NOT written to Y.Doc:', note.id)
        }
        set((state) => ({ notes: [...state.notes, note] }))
      },
      updateNote: (id, updates) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) {
          yjsWriteItem(ydoc, YJS_KEYS.STICKY_NOTES, id, updates)
        }
        set((state) => ({
          notes: state.notes.map((note) => 
            note.id === id ? { ...note, ...updates } : note
          ),
        }))
      },
      deleteNote: (id) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) {
          yjsDeleteItem(ydoc, YJS_KEYS.STICKY_NOTES, id)
        }
        set((state) => ({
          notes: state.notes.filter((note) => note.id !== id),
        }))
      },
    }),
    {
      name: 'sticky-notes-storage',
      storage: throttledStorage as any,
    }
  )
)
