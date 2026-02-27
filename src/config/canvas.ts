/**
 * Canvas Provider Configuration
 *
 * Switch between the custom canvas engine and tldraw by changing the
 * `CANVAS_PROVIDER` value below.
 *
 * - 'custom'  → Original BORDS canvas (dnd-kit, re-resizable, manual viewport)
 * - 'tldraw'  → tldraw-powered canvas (infinite canvas, built-in pan/zoom/select)
 */

export type CanvasProvider = 'custom' | 'tldraw'

export const CANVAS_PROVIDER: CanvasProvider = 'tldraw'

/* ── Helper hooks / utilities ── */

/** Check if the current canvas provider is tldraw */
export const isTldraw = () => (CANVAS_PROVIDER as string) === 'tldraw'

/** Check if the current canvas provider is the custom engine */
export const isCustomCanvas = () => (CANVAS_PROVIDER as string) === 'custom'
