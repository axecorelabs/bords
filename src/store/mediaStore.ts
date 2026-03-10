import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useCollabStore } from './collabStore'
import { yjsWriteItem, yjsDeleteItem, YJS_KEYS } from '@/lib/yjs-helpers'
import { throttledStorage } from '@/lib/throttled-storage'

export type MediaType = 'image' | 'video'

export interface Media {
  id: string
  url: string
  title?: string
  description?: string
  type: MediaType
  position: { x: number; y: number }
  width: number
  height: number
  color?: string
  createdAt: number
}

interface MediaStore {
  medias: Media[]
  isMediaModalOpen: boolean
  addMedia: (media: Omit<Media, 'id' | 'createdAt'>) => void
  updateMedia: (id: string, updates: Partial<Media>) => void
  deleteMedia: (id: string) => void
  openMediaModal: () => void
  closeMediaModal: () => void
}

export const useMediaStore = create<MediaStore>()(
  persist(
    (set) => ({
      medias: [],
      isMediaModalOpen: false,
      addMedia: (media) => {
        const fullMedia = {
          ...media,
          id: `media-${Date.now()}-${Math.random()}`,
          createdAt: Date.now(),
        }
        const { ydoc } = useCollabStore.getState()
        if (ydoc) {
          yjsWriteItem(ydoc, YJS_KEYS.MEDIA, fullMedia.id, fullMedia)
        }
        set((state) => ({
          medias: [...state.medias, fullMedia],
        }))
      },
      updateMedia: (id, updates) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) {
          yjsWriteItem(ydoc, YJS_KEYS.MEDIA, id, updates)
        }
        set((state) => ({
          medias: state.medias.map((media) =>
            media.id === id ? { ...media, ...updates } : media
          ),
        }))
      },
      deleteMedia: (id) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) {
          yjsDeleteItem(ydoc, YJS_KEYS.MEDIA, id)
        }
        set((state) => ({
          medias: state.medias.filter((media) => media.id !== id),
        }))
      },
      openMediaModal: () => set({ isMediaModalOpen: true }),
      closeMediaModal: () => set({ isMediaModalOpen: false }),
    }),
    {
      name: 'media-storage',
      storage: throttledStorage as any,
    }
  )
)
