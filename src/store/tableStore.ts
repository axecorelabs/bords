import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useCollabStore } from './collabStore'
import { yjsWriteItem, yjsDeleteItem, YJS_KEYS } from '@/lib/yjs-helpers'
import { throttledStorage } from '@/lib/throttled-storage'

export interface TableCell {
  value: string
}

export interface TableData {
  id: string
  title: string
  position: { x: number; y: number }
  width: number
  height: number
  color: string
  columns: string[] // Column headers
  rows: TableCell[][] // Each row is an array of cells
}

interface TableStore {
  tables: TableData[]
  addTable: (table: TableData) => void
  deleteTable: (id: string) => void
  updateTable: (id: string, updates: Partial<TableData>) => void
  updateCell: (tableId: string, rowIndex: number, colIndex: number, value: string) => void
  addRow: (tableId: string) => void
  deleteRow: (tableId: string, rowIndex: number) => void
  addColumn: (tableId: string, header: string) => void
  deleteColumn: (tableId: string, colIndex: number) => void
  updateColumnHeader: (tableId: string, colIndex: number, header: string) => void
}

export const useTableStore = create<TableStore>()(persist(
  (set) => {
    const syncTable = (tables: TableData[], tableId: string) => {
      const { ydoc } = useCollabStore.getState()
      if (!ydoc) return
      const t = tables.find((t) => t.id === tableId)
      if (t) yjsWriteItem(ydoc, YJS_KEYS.TABLES, tableId, t as any)
    }

    // Yjs may deserialize rows as objects with numeric keys instead of arrays
    const toArr = (v: any): any[] => Array.isArray(v) ? v : Object.values(v ?? {})

    return {
    tables: [],

    addTable: (table) => {
      const { ydoc } = useCollabStore.getState()
      if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.TABLES, table.id, table as any)
      set((state) => ({
        tables: [...state.tables, table],
      }))
    },

    deleteTable: (id) => {
      const { ydoc } = useCollabStore.getState()
      if (ydoc) yjsDeleteItem(ydoc, YJS_KEYS.TABLES, id)
      set((state) => ({
        tables: state.tables.filter((t) => t.id !== id),
      }))
    },

    updateTable: (id, updates) => set((state) => {
      const tables = state.tables.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      )
      // Send only partial updates — enables position debounce
      const { ydoc } = useCollabStore.getState()
      if (ydoc) yjsWriteItem(ydoc, YJS_KEYS.TABLES, id, updates as any)
      return { tables }
    }),

    updateCell: (tableId, rowIndex, colIndex, value) => set((state) => {
      const tables = state.tables.map((t) => {
        if (t.id !== tableId) return t
        const newRows = toArr(t.rows).map((row: any, ri: number) => {
          const cells = toArr(row)
          return ri === rowIndex
            ? cells.map((cell: any, ci: number) => (ci === colIndex ? { ...cell, value } : cell))
            : cells
        })
        return { ...t, rows: newRows }
      })
      syncTable(tables, tableId)
      return { tables }
    }),

    addRow: (tableId) => set((state) => {
      const tables = state.tables.map((t) => {
        if (t.id !== tableId) return t
        const newRow = t.columns.map(() => ({ value: '' }))
        return { ...t, rows: [...toArr(t.rows), newRow] }
      })
      syncTable(tables, tableId)
      return { tables }
    }),

    deleteRow: (tableId, rowIndex) => set((state) => {
      const tables = state.tables.map((t) => {
        if (t.id !== tableId) return t
        return { ...t, rows: toArr(t.rows).filter((_: any, i: number) => i !== rowIndex) }
      })
      syncTable(tables, tableId)
      return { tables }
    }),

    addColumn: (tableId, header) => set((state) => {
      const tables = state.tables.map((t) => {
        if (t.id !== tableId) return t
        return {
          ...t,
          columns: [...t.columns, header],
          rows: toArr(t.rows).map((row: any) => [...toArr(row), { value: '' }]),
        }
      })
      syncTable(tables, tableId)
      return { tables }
    }),

    deleteColumn: (tableId, colIndex) => set((state) => {
      const tables = state.tables.map((t) => {
        if (t.id !== tableId) return t
        return {
          ...t,
          columns: t.columns.filter((_, i) => i !== colIndex),
          rows: toArr(t.rows).map((row: any) => toArr(row).filter((_: any, i: number) => i !== colIndex)),
        }
      })
      syncTable(tables, tableId)
      return { tables }
    }),

    updateColumnHeader: (tableId, colIndex, header) => set((state) => {
      const tables = state.tables.map((t) => {
        if (t.id !== tableId) return t
        return {
          ...t,
          columns: t.columns.map((h, i) => (i === colIndex ? header : h)),
        }
      })
      syncTable(tables, tableId)
      return { tables }
    }),
  }},
  { name: 'bords-tables', storage: throttledStorage as any }
))
