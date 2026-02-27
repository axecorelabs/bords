'use client'

/**
 * tldraw Type Augmentation — registers ALL custom BORDS shapes with tldraw's type system.
 *
 * Import this file once (e.g. from TldrawCanvas) to activate the augmentation.
 * Individual shape utils import their extracted type from here.
 */

import type { TLShape } from 'tldraw'

/* ── Shape prop types ── */

export type BordsStickyNoteProps = {
  w: number
  h: number
  text: string
  color: string
  noteId: string
}

export type BordsTextProps = {
  w: number
  h: number
  text: string
  fontSize: number
  color: string       // hex color
  rotation: number
  textId: string
}

export type BordsChecklistProps = {
  w: number
  h: number
  title: string
  color: string       // tailwind class
  checklistId: string
}

export type BordsKanbanProps = {
  w: number
  h: number
  title: string
  color: string       // tailwind class
  kanbanId: string
}

export type BordsMediaProps = {
  w: number
  h: number
  url: string
  title: string
  mediaType: 'image' | 'video'  // renamed to avoid collision with shape `type`
  color: string
  mediaId: string
}

export type BordsReminderProps = {
  w: number
  h: number
  title: string
  color: string       // tailwind class
  reminderId: string
}

export type BordsTableProps = {
  w: number
  h: number
  title: string
  color: string
  tableId: string
}

/* ── Module augmentation — register shapes with tldraw ── */
declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    'bords-sticky-note': BordsStickyNoteProps
    'bords-text': BordsTextProps
    'bords-checklist': BordsChecklistProps
    'bords-kanban': BordsKanbanProps
    'bords-media': BordsMediaProps
    'bords-reminder': BordsReminderProps
    'bords-table': BordsTableProps
  }
}

/* ── Extracted shape types ── */
export type BordsStickyNote = Extract<TLShape, { type: 'bords-sticky-note' }>
export type BordsText = Extract<TLShape, { type: 'bords-text' }>
export type BordsChecklist = Extract<TLShape, { type: 'bords-checklist' }>
export type BordsKanban = Extract<TLShape, { type: 'bords-kanban' }>
export type BordsMedia = Extract<TLShape, { type: 'bords-media' }>
export type BordsReminder = Extract<TLShape, { type: 'bords-reminder' }>
export type BordsTable = Extract<TLShape, { type: 'bords-table' }>

/* ── Shared color map: tailwind class → CSS hex color ── */
export const TAILWIND_COLOR_MAP: Record<string, string> = {
  // boardColorOptions (with /80 opacity)
  'bg-yellow-200/80':  '#fef08acc',
  'bg-amber-200/80':   '#fde68acc',
  'bg-orange-200/80':  '#fed7aacc',
  'bg-red-200/80':     '#fecacacc',
  'bg-rose-200/80':    '#fecdd3cc',
  'bg-pink-200/80':    '#fbcfe8cc',
  'bg-fuchsia-200/80': '#f5d0fecc',
  'bg-purple-200/80':  '#e9d5ffcc',
  'bg-violet-200/80':  '#ddd6fecc',
  'bg-indigo-200/80':  '#c7d2fecc',
  'bg-blue-200/80':    '#bfdbfecc',
  'bg-sky-200/80':     '#bae6fdcc',
  'bg-cyan-200/80':    '#a5f3fccc',
  'bg-teal-200/80':    '#99f6e4cc',
  'bg-emerald-200/80': '#a7f3d0cc',
  'bg-green-200/80':   '#bbf7d0cc',
  'bg-lime-200/80':    '#d9f99dcc',
  'bg-stone-200/80':   '#e7e5e4cc',
  'bg-zinc-200/80':    '#e4e4e7cc',
  'bg-white/90':       '#ffffffe6',
  // Legacy / non-opacity
  'bg-yellow-200':  '#fef08a',
  'bg-blue-200':    '#bfdbfe',
  'bg-green-200':   '#bbf7d0',
  'bg-pink-200':    '#fbcfe8',
  'bg-purple-200':  '#e9d5ff',
  'bg-yellow-100':  '#fef9c3',
  'bg-blue-100':    '#dbeafe',
  'bg-green-100':   '#dcfce7',
  'bg-pink-100':    '#fce7f3',
  'bg-purple-100':  '#f3e8ff',
  // Checklist colors (/90 opacity)
  'bg-zinc-100/90':       '#f4f4f5e6',
  'bg-yellow-100/90':     '#fef9c3e6',
  'bg-blue-100/90':       '#dbeafee6',
  'bg-green-100/90':      '#dcfce7e6',
  'bg-pink-100/90':       '#fce7f3e6',
  'bg-purple-100/90':     '#f3e8ffe6',
  'bg-orange-100/90':     '#ffedd5e6',
  // Reminder colors
  'bg-amber-100/90':      '#fef3c7e6',
  'bg-rose-100/90':       '#ffe4e6e6',
  'bg-sky-100/90':        '#e0f2fee6',
  'bg-violet-100/90':     '#ede9fee6',
  'bg-emerald-100/90':    '#d1fae5e6',
  // Dark boardColorOptions (800 shades with /80 opacity)
  'bg-yellow-800/80':  '#854d0ecc',
  'bg-amber-800/80':   '#92400ecc',
  'bg-orange-800/80':  '#9a3412cc',
  'bg-red-800/80':     '#991b1bcc',
  'bg-rose-800/80':    '#9f1239cc',
  'bg-pink-800/80':    '#9d174dcc',
  'bg-fuchsia-800/80': '#86198fcc',
  'bg-purple-800/80':  '#6b21a8cc',
  'bg-violet-800/80':  '#5b21b6cc',
  'bg-indigo-800/80':  '#3730a3cc',
  'bg-blue-800/80':    '#1e40afcc',
  'bg-sky-800/80':     '#075985cc',
  'bg-cyan-800/80':    '#155e75cc',
  'bg-teal-800/80':    '#115e59cc',
  'bg-emerald-800/80': '#065f46cc',
  'bg-green-800/80':   '#166534cc',
  'bg-lime-800/80':    '#3f6212cc',
  'bg-stone-700/80':   '#44403ccc',
  'bg-zinc-700/80':    '#3f3f46cc',
  'bg-zinc-900/90':    '#18181be6',
}

export function resolveColor(cls: string): string {
  return TAILWIND_COLOR_MAP[cls] || '#fef08a'
}
