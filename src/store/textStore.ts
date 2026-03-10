import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useCollabStore } from './collabStore'
import { yjsWriteItem, yjsDeleteItem, YJS_KEYS } from '@/lib/yjs-helpers'
import { throttledStorage } from '@/lib/throttled-storage'

export interface TextElement {
  id: string
  text: string
  position: { x: number; y: number }
  fontSize: number
  color: string
  rotation?: number
  width?: number
}

interface TextStore {
  texts: TextElement[]
  addText: (text: TextElement) => void
  updateText: (id: string, updates: Partial<TextElement>) => void
  deleteText: (id: string) => void
}

export const useTextStore = create<TextStore>()(
  persist(
    (set) => ({
      texts: [],
      addText: (text) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) {
          yjsWriteItem(ydoc, YJS_KEYS.TEXTS, text.id, text)
        }
        set((state) => ({ texts: [...state.texts, text] }))
      },
      updateText: (id, updates) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) {
          yjsWriteItem(ydoc, YJS_KEYS.TEXTS, id, updates)
        }
        set((state) => ({
          texts: state.texts.map((text) => 
            text.id === id ? { ...text, ...updates } : text
          )
        }))
      },
      deleteText: (id) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) {
          yjsDeleteItem(ydoc, YJS_KEYS.TEXTS, id)
        }
        set((state) => ({
          texts: state.texts.filter((text) => text.id !== id)
        }))
      }
    }),
    {
      name: 'text-storage',
      storage: throttledStorage as any,
    }
  )
)
