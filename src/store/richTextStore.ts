import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useCollabStore } from './collabStore'
import { yjsWriteItem, yjsDeleteItem, YJS_KEYS } from '@/lib/yjs-helpers'
import { throttledStorage } from '@/lib/throttled-storage'

export interface RichTextDoc {
  id: string
  title: string
  /** Tiptap JSON content — serialized as a plain object */
  content: Record<string, any>
  position: { x: number; y: number }
  width: number
  height: number
  color: string
}

interface RichTextStore {
  docs: RichTextDoc[]
  addDoc: (doc: RichTextDoc) => void
  updateDoc: (id: string, updates: Partial<RichTextDoc>) => void
  deleteDoc: (id: string) => void
}

export const useRichTextStore = create<RichTextStore>()(
  persist(
    (set) => ({
      docs: [],

      addDoc: (doc) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.RICH_TEXTS, doc.id, doc as any)
        set((state) => ({ docs: [...state.docs, doc] }))
      },

      updateDoc: (id, updates) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.RICH_TEXTS, id, updates as any)
        set((state) => ({
          docs: state.docs.map((d) => (d.id === id ? { ...d, ...updates } : d)),
        }))
      },

      deleteDoc: (id) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) yjsDeleteItem(ydoc, YJS_KEYS.RICH_TEXTS, id)
        set((state) => ({ docs: state.docs.filter((d) => d.id !== id) }))
      },
    }),
    {
      name: 'rich-text-storage',
      storage: throttledStorage as any,
    }
  )
)
