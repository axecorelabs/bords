import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
  (set) => ({
    tables: [],

    addTable: (table) => set((state) => ({
      tables: [...state.tables, table],
    })),

    deleteTable: (id) => set((state) => ({
      tables: state.tables.filter((t) => t.id !== id),
    })),

    updateTable: (id, updates) => set((state) => ({
      tables: state.tables.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    })),

    updateCell: (tableId, rowIndex, colIndex, value) => set((state) => ({
      tables: state.tables.map((t) => {
        if (t.id !== tableId) return t
        const newRows = t.rows.map((row, ri) =>
          ri === rowIndex
            ? row.map((cell, ci) => (ci === colIndex ? { ...cell, value } : cell))
            : row
        )
        return { ...t, rows: newRows }
      }),
    })),

    addRow: (tableId) => set((state) => ({
      tables: state.tables.map((t) => {
        if (t.id !== tableId) return t
        const newRow = t.columns.map(() => ({ value: '' }))
        return { ...t, rows: [...t.rows, newRow] }
      }),
    })),

    deleteRow: (tableId, rowIndex) => set((state) => ({
      tables: state.tables.map((t) => {
        if (t.id !== tableId) return t
        return { ...t, rows: t.rows.filter((_, i) => i !== rowIndex) }
      }),
    })),

    addColumn: (tableId, header) => set((state) => ({
      tables: state.tables.map((t) => {
        if (t.id !== tableId) return t
        return {
          ...t,
          columns: [...t.columns, header],
          rows: t.rows.map((row) => [...row, { value: '' }]),
        }
      }),
    })),

    deleteColumn: (tableId, colIndex) => set((state) => ({
      tables: state.tables.map((t) => {
        if (t.id !== tableId) return t
        return {
          ...t,
          columns: t.columns.filter((_, i) => i !== colIndex),
          rows: t.rows.map((row) => row.filter((_, i) => i !== colIndex)),
        }
      }),
    })),

    updateColumnHeader: (tableId, colIndex, header) => set((state) => ({
      tables: state.tables.map((t) => {
        if (t.id !== tableId) return t
        return {
          ...t,
          columns: t.columns.map((h, i) => (i === colIndex ? header : h)),
        }
      }),
    })),
  }),
  { name: 'bords-tables' }
))
