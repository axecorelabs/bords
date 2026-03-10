/**
 * Three-way merge engine for BORDS board data.
 *
 * Uses the same strategy as `git merge`:
 *   base  = the common ancestor (last synced state)
 *   local = your current local state
 *   cloud = the current cloud state (from the 409 response)
 *
 * Merge rules per item (by `id`):
 *   ┌──────────────────────┬──────────────────┬──────────────────────────────┐
 *   │ Local                │ Cloud            │ Resolution                   │
 *   ├──────────────────────┼──────────────────┼──────────────────────────────┤
 *   │ unchanged            │ unchanged        │ keep as-is                   │
 *   │ modified             │ unchanged        │ take local                   │
 *   │ unchanged            │ modified         │ take cloud                   │
 *   │ modified             │ modified         │ CONFLICT (user decides)      │
 *   │ deleted              │ unchanged        │ accept deletion              │
 *   │ unchanged            │ deleted          │ accept deletion              │
 *   │ deleted              │ modified         │ CONFLICT (delete vs modify)  │
 *   │ modified             │ deleted          │ CONFLICT (modify vs delete)  │
 *   │ deleted              │ deleted          │ accept deletion              │
 *   │ added (new)          │ —                │ keep local addition          │
 *   │ —                    │ added (new)      │ keep cloud addition          │
 *   │ added (same id)      │ added (same id)  │ CONFLICT if content differs  │
 *   └──────────────────────┴──────────────────┴──────────────────────────────┘
 */

import { CONTENT_COLLECTIONS, getItemLabel } from './boardDiff'

/* ── Types ── */

export type ConflictType = 'both_modified' | 'delete_vs_modify' | 'both_added'

export interface MergeConflict {
  collection: string
  itemId: string
  type: ConflictType
  localVersion?: any
  cloudVersion?: any
  baseVersion?: any
  description: string
}

export interface AutoResolved {
  collection: string
  itemId: string
  resolution: string
}

export interface MergeResult {
  merged: any
  conflicts: MergeConflict[]
  autoResolved: AutoResolved[]
  hasConflicts: boolean
}

/* ── Internal helpers ── */

function itemHash(item: any): string {
  if (!item) return ''
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, __v, ...clean } = item
  return JSON.stringify(clean)
}

/* ── Merge a single collection ── */

function mergeCollection(
  collection: string,
  base: any[],
  local: any[],
  cloud: any[],
): { merged: any[]; conflicts: MergeConflict[]; autoResolved: AutoResolved[] } {
  const baseMap   = new Map<string, any>()
  const baseHash  = new Map<string, string>()
  const localMap  = new Map<string, any>()
  const localHash = new Map<string, string>()
  const cloudMap  = new Map<string, any>()
  const cloudHash = new Map<string, string>()

  for (const item of base  || []) { if (item?.id) { baseMap.set(item.id, item);  baseHash.set(item.id, itemHash(item))  } }
  for (const item of local || []) { if (item?.id) { localMap.set(item.id, item); localHash.set(item.id, itemHash(item)) } }
  for (const item of cloud || []) { if (item?.id) { cloudMap.set(item.id, item); cloudHash.set(item.id, itemHash(item)) } }

  const merged: any[] = []
  const conflicts: MergeConflict[] = []
  const autoResolved: AutoResolved[] = []

  const allIds = new Set([...baseMap.keys(), ...localMap.keys(), ...cloudMap.keys()])

  for (const id of allIds) {
    const inBase  = baseMap.has(id)
    const inLocal = localMap.has(id)
    const inCloud = cloudMap.has(id)

    const localChanged  = inBase && inLocal && baseHash.get(id) !== localHash.get(id)
    const cloudChanged  = inBase && inCloud && baseHash.get(id) !== cloudHash.get(id)
    const localDeleted  = inBase && !inLocal
    const cloudDeleted  = inBase && !inCloud
    const localAdded    = !inBase && inLocal
    const cloudAdded    = !inBase && inCloud

    /* ── Case 1: item existed in base and is present in both ── */
    if (inBase && inLocal && inCloud) {
      if (!localChanged && !cloudChanged) {
        merged.push(localMap.get(id))
      } else if (localChanged && !cloudChanged) {
        merged.push(localMap.get(id))
        autoResolved.push({ collection, itemId: id, resolution: 'took local (only you modified)' })
      } else if (!localChanged && cloudChanged) {
        merged.push(cloudMap.get(id))
        autoResolved.push({ collection, itemId: id, resolution: 'took cloud (only other editor modified)' })
      } else {
        // Both modified → CONFLICT
        conflicts.push({
          collection,
          itemId: id,
          type: 'both_modified',
          localVersion:  localMap.get(id),
          cloudVersion:  cloudMap.get(id),
          baseVersion:   baseMap.get(id),
          description: `${getItemLabel(collection, localMap.get(id))} was modified by both you and another editor`,
        })
        // Temporarily keep cloud version (will be overridden by resolution)
        merged.push(cloudMap.get(id))
      }
    }

    /* ── Case 2: deleted by local, still exists in cloud ── */
    else if (localDeleted && inCloud) {
      if (cloudChanged) {
        conflicts.push({
          collection, itemId: id, type: 'delete_vs_modify',
          cloudVersion: cloudMap.get(id),
          baseVersion:  baseMap.get(id),
          description: `${getItemLabel(collection, baseMap.get(id))} was deleted by you but modified by another editor`,
        })
        merged.push(cloudMap.get(id))
      } else {
        autoResolved.push({ collection, itemId: id, resolution: 'accepted your deletion' })
      }
    }

    /* ── Case 3: deleted by cloud, still exists locally ── */
    else if (cloudDeleted && inLocal) {
      if (localChanged) {
        conflicts.push({
          collection, itemId: id, type: 'delete_vs_modify',
          localVersion: localMap.get(id),
          baseVersion:  baseMap.get(id),
          description: `${getItemLabel(collection, baseMap.get(id))} was deleted by another editor but you modified it`,
        })
        merged.push(localMap.get(id))
      } else {
        autoResolved.push({ collection, itemId: id, resolution: 'accepted cloud deletion' })
      }
    }

    /* ── Case 4: deleted by both ── */
    else if (localDeleted && cloudDeleted) {
      autoResolved.push({ collection, itemId: id, resolution: 'both sides deleted' })
    }

    /* ── Case 5: added only locally ── */
    else if (localAdded && !cloudAdded) {
      merged.push(localMap.get(id))
      autoResolved.push({ collection, itemId: id, resolution: 'your new item added' })
    }

    /* ── Case 6: added only by cloud ── */
    else if (cloudAdded && !localAdded) {
      merged.push(cloudMap.get(id))
      autoResolved.push({ collection, itemId: id, resolution: 'other editor\'s new item added' })
    }

    /* ── Case 7: both sides added with the same ID ── */
    else if (localAdded && cloudAdded) {
      if (localHash.get(id) === cloudHash.get(id)) {
        merged.push(localMap.get(id))
        autoResolved.push({ collection, itemId: id, resolution: 'identical item added by both' })
      } else {
        conflicts.push({
          collection, itemId: id, type: 'both_added',
          localVersion:  localMap.get(id),
          cloudVersion:  cloudMap.get(id),
          description: `${getItemLabel(collection, localMap.get(id))} was added by both you and another editor with different content`,
        })
        merged.push(localMap.get(id))
      }
    }
  }

  return { merged, conflicts, autoResolved }
}

/* ── Merge the full board (all collections + settings + z-index) ── */

export function mergeBoards(base: any, local: any, cloud: any): MergeResult {
  const merged: any = {}
  const allConflicts: MergeConflict[] = []
  const allAutoResolved: AutoResolved[] = []

  // ── 1. Merge each content collection ──
  for (const col of CONTENT_COLLECTIONS) {
    const { merged: m, conflicts: c, autoResolved: a } = mergeCollection(
      col, base?.[col] || [], local?.[col] || [], cloud?.[col] || []
    )
    merged[col] = m
    allConflicts.push(...c)
    allAutoResolved.push(...a)
  }

  // ── 2. Background — take cloud if it changed from base, else take local ──
  const bgFields = [
    'backgroundImage', 'backgroundColor', 'backgroundOverlay',
    'backgroundOverlayColor', 'backgroundBlurLevel',
  ]
  for (const f of bgFields) {
    const baseVal  = JSON.stringify(base?.[f] ?? null)
    const cloudVal = JSON.stringify(cloud?.[f] ?? null)
    merged[f] = cloudVal !== baseVal ? cloud?.[f] : local?.[f]
  }

  // ── 3. Settings — same strategy ──
  for (const f of ['connectionLineSettings', 'gridSettings', 'themeSettings']) {
    const baseVal  = JSON.stringify(base?.[f] ?? null)
    const cloudVal = JSON.stringify(cloud?.[f] ?? null)
    merged[f] = cloudVal !== baseVal ? cloud?.[f] : local?.[f]
  }

  // ── 3b. Native tldraw shapes — cloud wins if changed from base, else keep local ──
  {
    const baseVal  = JSON.stringify(base?.nativeTldraw ?? null)
    const cloudVal = JSON.stringify(cloud?.nativeTldraw ?? null)
    merged.nativeTldraw = cloudVal !== baseVal ? cloud?.nativeTldraw : local?.nativeTldraw
  }

  // ── 4. Z-index — merge additively, prefer higher values ──
  const localZMap = new Map<string, number>()
  const cloudZMap = new Map<string, number>()
  for (const e of local?.zIndexData?.entries || []) localZMap.set(e.itemId, e.zIndex)
  for (const e of cloud?.zIndexData?.entries || []) cloudZMap.set(e.itemId, e.zIndex)

  const mergedZMap = new Map<string, number>()
  for (const id of new Set([...localZMap.keys(), ...cloudZMap.keys()])) {
    mergedZMap.set(id, Math.max(localZMap.get(id) ?? 0, cloudZMap.get(id) ?? 0))
  }
  merged.zIndexData = {
    counter: Math.max(local?.zIndexData?.counter || 0, cloud?.zIndexData?.counter || 0),
    entries: Array.from(mergedZMap.entries()).map(([itemId, zIndex]) => ({ itemId, zIndex })),
  }

  // ── 5. Rebuild itemIds from the merged collections ──
  merged.itemIds = {
    notes:       (merged.stickyNotes  || []).map((n: any) => n.id),
    checklists:  (merged.checklists   || []).map((c: any) => c.id),
    texts:       (merged.textElements || []).map((t: any) => t.id),
    connections: (merged.connections   || []).map((c: any) => c.id),
    drawings:    (merged.drawings     || []).map((d: any) => d.id),
    kanbans:     (merged.kanbanBoards || []).map((k: any) => k.id),
    medias:      (merged.mediaItems   || []).map((m: any) => m.id),
    reminders:   (merged.reminders    || []).map((r: any) => r.id),
    tables:      (merged.tables       || []).map((t: any) => t.id),
  }

  return {
    merged,
    conflicts: allConflicts,
    autoResolved: allAutoResolved,
    hasConflicts: allConflicts.length > 0,
  }
}

/* ── Apply user's conflict resolutions to a merged board ── */

export function applyConflictResolutions(
  merged: any,
  resolutions: Record<string, 'local' | 'cloud' | 'both'>,
  conflicts: MergeConflict[],
): any {
  const result = JSON.parse(JSON.stringify(merged)) // deep clone

  for (const conflict of conflicts) {
    const key = `${conflict.collection}:${conflict.itemId}`
    const resolution = resolutions[key]
    if (!resolution) continue

    const col = conflict.collection
    const items: any[] = result[col] || []
    const idx = items.findIndex((item: any) => item.id === conflict.itemId)

    if (resolution === 'local') {
      if (conflict.localVersion) {
        if (idx >= 0) items[idx] = conflict.localVersion
        else items.push(conflict.localVersion)
      } else {
        // Local deleted → remove the item
        if (idx >= 0) items.splice(idx, 1)
      }
    } else if (resolution === 'cloud') {
      if (conflict.cloudVersion) {
        if (idx >= 0) items[idx] = conflict.cloudVersion
        else items.push(conflict.cloudVersion)
      } else {
        // Cloud deleted → remove the item
        if (idx >= 0) items.splice(idx, 1)
      }
    } else if (resolution === 'both') {
      // Keep both — local at its position, cloud as a copy with offset position
      if (conflict.localVersion && conflict.cloudVersion) {
        if (idx >= 0) items[idx] = conflict.localVersion
        else items.push(conflict.localVersion)

        const cloudCopy = JSON.parse(JSON.stringify(conflict.cloudVersion))
        cloudCopy.id = `${conflict.cloudVersion.id}-merge-${Date.now()}`
        // Offset position so items don't overlap
        if (cloudCopy.position) {
          cloudCopy.position = {
            x: (cloudCopy.position.x || 0) + 30,
            y: (cloudCopy.position.y || 0) + 30,
          }
        }
        items.push(cloudCopy)
      }
    }

    result[col] = items
  }

  // Rebuild itemIds after resolution
  result.itemIds = {
    notes:       (result.stickyNotes  || []).map((n: any) => n.id),
    checklists:  (result.checklists   || []).map((c: any) => c.id),
    texts:       (result.textElements || []).map((t: any) => t.id),
    connections: (result.connections   || []).map((c: any) => c.id),
    drawings:    (result.drawings     || []).map((d: any) => d.id),
    kanbans:     (result.kanbanBoards || []).map((k: any) => k.id),
    medias:      (result.mediaItems   || []).map((m: any) => m.id),
    reminders:   (result.reminders    || []).map((r: any) => r.id),
  }

  return result
}
