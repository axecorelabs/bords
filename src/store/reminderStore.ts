import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useCollabStore } from './collabStore'
import { yjsWriteItem, yjsDeleteItem, YJS_KEYS } from '@/lib/yjs-helpers'
import { throttledStorage } from '@/lib/throttled-storage'

export const REMINDER_COLORS = {
  amber: 'bg-amber-100/90',
  rose: 'bg-rose-100/90',
  sky: 'bg-sky-100/90',
  violet: 'bg-violet-100/90',
  emerald: 'bg-emerald-100/90',
  orange: 'bg-orange-100/90',
  pink: 'bg-pink-100/90',
  white: 'bg-white/90',
}

export interface ReminderItem {
  id: string
  text: string
  dueDate?: string      // ISO date string e.g. '2026-03-01'
  dueTime?: string      // HH:mm e.g. '14:30'
  completed: boolean
  completedAt?: string   // ISO datetime
}

export interface Reminder {
  id: string
  title: string
  items: ReminderItem[]
  position: { x: number; y: number }
  color: string
  createdAt: string      // ISO datetime
  width?: number
  height?: number
  /** When set, this reminder is assigned to a friend (shows in their personal inbox) */
  assignedTo?: {
    friendId: string
    userId: string
    firstName: string
    lastName: string
    email: string
  } | null
}

interface ReminderStore {
  reminders: Reminder[]
  addReminder: (reminder: Reminder) => void
  updateReminder: (id: string, updates: Partial<Reminder>) => void
  deleteReminder: (id: string) => void
  toggleItem: (reminderId: string, itemId: string) => void
  updateItem: (reminderId: string, itemId: string, updates: Partial<ReminderItem>) => void
  addItem: (reminderId: string, item: ReminderItem) => void
  removeItem: (reminderId: string, itemId: string) => void
  reorderItem: (reminderId: string, fromIndex: number, toIndex: number) => void
}

export const useReminderStore = create<ReminderStore>()(
  persist(
    (set, get) => {
      const syncReminder = (reminders: Reminder[], reminderId: string) => {
        const { ydoc } = useCollabStore.getState()
        if (!ydoc) return
        const r = reminders.find((r) => r.id === reminderId)
        if (r) yjsWriteItem(ydoc, YJS_KEYS.REMINDERS, reminderId, r as any)
      }

      return {
      reminders: [],

      addReminder: (reminder) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.REMINDERS, reminder.id, reminder as any)
        set((state) => ({ reminders: [...state.reminders, reminder] }))
      },

      updateReminder: (id, updates) => {
        // Send only partial updates — enables position debounce
        const { ydoc } = useCollabStore.getState()
        if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.REMINDERS, id, updates as any)
        set((state) => ({
          reminders: state.reminders.map((r) =>
            r.id === id ? { ...r, ...updates } : r
          ),
        }))
      },

      deleteReminder: (id) => {
        const { ydoc } = useCollabStore.getState()
        if (ydoc) yjsDeleteItem(ydoc, YJS_KEYS.REMINDERS, id)
        set((state) => ({
          reminders: state.reminders.filter((r) => r.id !== id),
        }))
      },

      toggleItem: (reminderId, itemId) =>
        set((state) => {
          const reminders = state.reminders.map((r) =>
            r.id === reminderId
              ? {
                  ...r,
                  items: r.items.map((item) =>
                    item.id === itemId
                      ? {
                          ...item,
                          completed: !item.completed,
                          completedAt: !item.completed ? new Date().toISOString() : undefined,
                        }
                      : item
                  ),
                }
              : r
          )
          syncReminder(reminders, reminderId)
          return { reminders }
        }),

      updateItem: (reminderId, itemId, updates) =>
        set((state) => {
          const reminders = state.reminders.map((r) =>
            r.id === reminderId
              ? {
                  ...r,
                  items: r.items.map((item) =>
                    item.id === itemId ? { ...item, ...updates } : item
                  ),
                }
              : r
          )
          syncReminder(reminders, reminderId)
          return { reminders }
        }),

      addItem: (reminderId, item) =>
        set((state) => {
          const reminders = state.reminders.map((r) =>
            r.id === reminderId
              ? { ...r, items: [...r.items, item] }
              : r
          )
          syncReminder(reminders, reminderId)
          return { reminders }
        }),

      removeItem: (reminderId, itemId) =>
        set((state) => {
          const reminders = state.reminders.map((r) =>
            r.id === reminderId
              ? { ...r, items: r.items.filter((item) => item.id !== itemId) }
              : r
          )
          syncReminder(reminders, reminderId)
          return { reminders }
        }),

      reorderItem: (reminderId, fromIndex, toIndex) =>
        set((state) => {
          const reminders = state.reminders.map((r) => {
            if (r.id !== reminderId) return r
            const newItems = [...r.items]
            const [moved] = newItems.splice(fromIndex, 1)
            newItems.splice(toIndex, 0, moved)
            return { ...r, items: newItems }
          })
          syncReminder(reminders, reminderId)
          return { reminders }
        }),
    }},
    {
      name: 'reminder-storage',
      storage: throttledStorage as any,
    }
  )
)
