/**
 * ydoc-extract.ts — Server-side Y.Doc → board content extractor
 *
 * Used by the save-state REST route to populate board_documents from the
 * Y.Doc binary state so the AI indexer can read manually-created board content.
 *
 * This file MUST NOT import from yjs-bindings.ts or any 'use client' module.
 */

import * as Y from 'yjs'

const KEYS = {
  BOARD_META:  'boardMeta',
  STICKY_NOTES:'stickyNotes',
  CHECKLISTS:  'checklists',
  KANBANS:     'kanbanBoards',
  TEXTS:       'texts',
  MEDIA:       'mediaItems',
  CONNECTIONS: 'connections',
  DRAWINGS:    'drawings',
  REMINDERS:   'reminders',
  TABLES:      'tables',
  RICH_TEXTS:  'richTexts',
  TLDRAW_SHAPES: 'tldrawShapes',
  TLDRAW_BINDINGS: 'tldrawBindings',
  TLDRAW_ASSETS: 'tldrawAssets',
} as const

// ── Y.Map → plain object (recursive) ────────────────────────────────

function yjsToJs(value: unknown): unknown {
  if (value instanceof Y.Map) {
    const obj: Record<string, unknown> = {}
    value.forEach((v, k) => { obj[k] = yjsToJs(v) })
    return obj
  }
  if (value instanceof Y.Array) {
    return value.toArray().map(yjsToJs)
  }
  return value
}

function ymapCollection(ydoc: Y.Doc, key: string): unknown[] {
  const ymap = ydoc.getMap(key)
  const items: unknown[] = []
  ymap.forEach((value, id) => {
    if (value instanceof Y.Map) {
      const obj = yjsToJs(value) as Record<string, unknown>
      obj['id'] = id  // canonical id is the map key
      items.push(obj)
    }
  })
  return items
}

function ymapMeta(ydoc: Y.Doc, key: string): Record<string, unknown> {
  const ymap = ydoc.getMap(key)
  const obj: Record<string, unknown> = {}
  ymap.forEach((value, k) => { obj[k] = yjsToJs(value) })
  return obj
}

// ── tldraw native (shapes/bindings/assets are plain maps) ───────────

function tldrawNative(ydoc: Y.Doc): Record<string, unknown> | null {
  const shapes = ydoc.getMap(KEYS.TLDRAW_SHAPES)
  const bindings = ydoc.getMap(KEYS.TLDRAW_BINDINGS)
  const assets = ydoc.getMap(KEYS.TLDRAW_ASSETS)
  if (shapes.size === 0 && bindings.size === 0 && assets.size === 0) return null
  return {
    shapes:   ymapMeta(ydoc, KEYS.TLDRAW_SHAPES),
    bindings: ymapMeta(ydoc, KEYS.TLDRAW_BINDINGS),
    assets:   ymapMeta(ydoc, KEYS.TLDRAW_ASSETS),
  }
}

// ── Public API ───────────────────────────────────────────────────────

export interface ExtractedBoardContent {
  stickyNotes:  unknown[]
  checklists:   unknown[]
  kanbanBoards: unknown[]
  textElements: unknown[]
  mediaItems:   unknown[]
  connections:  unknown[]
  drawings:     unknown[]
  reminders:    unknown[]
  tables:       unknown[]
  richTexts:    unknown[]
  nativeTldraw: Record<string, unknown> | null
  boardMeta:    Record<string, unknown>
}

/**
 * Decode a base64 Y.Doc state update and extract all board content.
 * Returns structured content ready for boardContentToRow().
 */
export function extractBoardContentFromYDoc(stateBase64: string): ExtractedBoardContent {
  const ydoc = new Y.Doc()
  const stateBytes = Buffer.from(stateBase64, 'base64')
  Y.applyUpdate(ydoc, stateBytes)

  return {
    stickyNotes:  ymapCollection(ydoc, KEYS.STICKY_NOTES),
    checklists:   ymapCollection(ydoc, KEYS.CHECKLISTS),
    kanbanBoards: ymapCollection(ydoc, KEYS.KANBANS),
    textElements: ymapCollection(ydoc, KEYS.TEXTS),
    mediaItems:   ymapCollection(ydoc, KEYS.MEDIA),
    connections:  ymapCollection(ydoc, KEYS.CONNECTIONS),
    drawings:     ymapCollection(ydoc, KEYS.DRAWINGS),
    reminders:    ymapCollection(ydoc, KEYS.REMINDERS),
    tables:       ymapCollection(ydoc, KEYS.TABLES),
    richTexts:    ymapCollection(ydoc, KEYS.RICH_TEXTS),
    nativeTldraw: tldrawNative(ydoc),
    boardMeta:    ymapMeta(ydoc, KEYS.BOARD_META),
  }
}
