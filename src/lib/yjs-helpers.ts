'use client'

/**
 * Yjs Write Helpers & Constants
 *
 * This file is intentionally free of Zustand store imports to avoid
 * circular dependencies.  Stores import from here; yjs-bindings.ts
 * re-exports as needed and imports stores for the observer/binding layer.
 */

import * as Y from 'yjs'

// ─── Y.Map key constants ────────────────────────────────────────────
export const YJS_KEYS = {
  BOARD_META: 'boardMeta',
  STICKY_NOTES: 'stickyNotes',
  CHECKLISTS: 'checklists',
  KANBANS: 'kanbanBoards',
  TEXTS: 'texts',
  MEDIA: 'mediaItems',
  CONNECTIONS: 'connections',
  DRAWINGS: 'drawings',
  REMINDERS: 'reminders',
  TABLES: 'tables',
  TLDRAW_SHAPES: 'tldrawShapes',
  TLDRAW_BINDINGS: 'tldrawBindings',
  TLDRAW_ASSETS: 'tldrawAssets',
} as const

// ─── Flag to suppress observer → store loops ────────────────────────
let _suppressObserver = false
export function isSuppressed(): boolean { return _suppressObserver }
export function setSuppressObserver(val: boolean) { _suppressObserver = val }

// ─── Helpers: plain object ↔ Y.Map ──────────────────────────────────

/** Convert a plain JS object (possibly nested) into a Y.Map tree. */
function jsToYjs(value: any): any {
  if (value === undefined) return undefined
  if (Array.isArray(value)) {
    const yarr = new Y.Array()
    yarr.push(value.map(item => jsToYjs(item)))
    return yarr
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object' && value !== null) return objectToYMap(value)
  return value
}

export function objectToYMap(obj: Record<string, any>): Y.Map<any> {
  const ymap = new Y.Map()
  for (const [key, value] of Object.entries(obj)) {
    const yval = jsToYjs(value)
    if (yval !== undefined) ymap.set(key, yval)
  }
  return ymap
}

/** Convert a Y.Map tree back to a plain JS object. */
function yjsToJs(value: any): any {
  if (value instanceof Y.Map) return yMapToObject(value)
  if (value instanceof Y.Array) return value.toArray().map(item => yjsToJs(item))
  return value
}

export function yMapToObject(ymap: Y.Map<any>): Record<string, any> {
  const obj: Record<string, any> = {}
  ymap.forEach((value, key) => {
    obj[key] = yjsToJs(value)
  })
  return obj
}

// ─── Debounce buffer for high-frequency updates ─────────────────────
const _pendingWrites = new Map<string, { ydoc: Y.Doc; collectionKey: string; itemId: string; data: Record<string, any> }>()
let _flushTimer: ReturnType<typeof setTimeout> | null = null
const WRITE_DEBOUNCE_MS = 30

function flushPendingWrites() {
  _flushTimer = null
  const entries = Array.from(_pendingWrites.values())
  _pendingWrites.clear()
  for (const { ydoc, collectionKey, itemId, data } of entries) {
    _writeToYDoc(ydoc, collectionKey, itemId, data)
  }
}

function isPositionOnlyUpdate(data: Record<string, any>): boolean {
  const keys = Object.keys(data)
  const posKeys = new Set(['position', 'x', 'y', 'width', 'height', 'w', 'h'])
  return keys.length > 0 && keys.every(k => posKeys.has(k))
}

// ─── Write helpers (called from store actions) ──────────────────────

/**
 * Write/update a single item into a Yjs collection map.
 * Position-only updates are debounced to reduce Y.Doc churn during drag.
 */
export function yjsWriteItem(
  ydoc: Y.Doc,
  collectionKey: string,
  itemId: string,
  data: Record<string, any>
) {
  if (isPositionOnlyUpdate(data)) {
    const key = `${collectionKey}::${itemId}`
    const existing = _pendingWrites.get(key)
    _pendingWrites.set(key, {
      ydoc,
      collectionKey,
      itemId,
      data: existing ? { ...existing.data, ...data } : data,
    })
    if (!_flushTimer) {
      _flushTimer = setTimeout(flushPendingWrites, WRITE_DEBOUNCE_MS)
    }
    return
  }
  _writeToYDoc(ydoc, collectionKey, itemId, data)
}

function _writeToYDoc(
  ydoc: Y.Doc,
  collectionKey: string,
  itemId: string,
  data: Record<string, any>
) {
  _suppressObserver = true
  try {
    ydoc.transact(() => {
      const collection = ydoc.getMap(collectionKey)
      const existing = collection.get(itemId)
      if (existing instanceof Y.Map) {
        for (const [key, value] of Object.entries(data)) {
          const yval = jsToYjs(value)
          if (yval !== undefined) existing.set(key, yval)
        }
      } else if (data.id) {
        // Full object with id — safe to create new Y.Map
        collection.set(itemId, objectToYMap(data))
      } else {
        // Partial update for an item that doesn't exist in Y.Doc yet.
        // Skip — creating a Y.Map from partial data would lose fields
        // (e.g. only position without text/color).
        // The item will be written in full on next pushStoreToYDoc.
        if (typeof console !== 'undefined') {
          console.debug('[yjs] skipping partial write for missing item', collectionKey, itemId)
        }
      }
    })
  } finally {
    _suppressObserver = false
  }
}

/** Delete an item from a Yjs collection map. */
export function yjsDeleteItem(
  ydoc: Y.Doc,
  collectionKey: string,
  itemId: string
) {
  _suppressObserver = true
  try {
    ydoc.transact(() => {
      ydoc.getMap(collectionKey).delete(itemId)
    })
  } finally {
    _suppressObserver = false
  }
}

/** Write board metadata (background, name, etc.) */
export function yjsWriteBoardMeta(
  ydoc: Y.Doc,
  key: string,
  value: any
) {
  _suppressObserver = true
  try {
    ydoc.transact(() => {
      ydoc.getMap(YJS_KEYS.BOARD_META).set(key, value ?? null)
    })
  } finally {
    _suppressObserver = false
  }
}

/** Write tldraw native shape data. */
export function yjsWriteTldrawShape(
  ydoc: Y.Doc,
  shapeId: string,
  data: Record<string, any>
) {
  _suppressObserver = true
  try {
    ydoc.transact(() => {
      ydoc.getMap(YJS_KEYS.TLDRAW_SHAPES).set(shapeId, objectToYMap(data))
    })
  } finally {
    _suppressObserver = false
  }
}

/** Delete tldraw native shape. */
export function yjsDeleteTldrawShape(ydoc: Y.Doc, shapeId: string) {
  _suppressObserver = true
  try {
    ydoc.transact(() => {
      ydoc.getMap(YJS_KEYS.TLDRAW_SHAPES).delete(shapeId)
    })
  } finally {
    _suppressObserver = false
  }
}
