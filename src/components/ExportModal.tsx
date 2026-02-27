'use client'
import { useState, useEffect } from 'react'
import { X, Download, Image as ImageIcon, Loader2 } from 'lucide-react'
import { useExportStore } from '../store/exportStore'
import { useBoardStore } from '../store/boardStore'
import { useThemeStore } from '../store/themeStore'
import { useNoteStore } from '../store/stickyNoteStore'
import { useChecklistStore } from '../store/checklistStore'
import { useTextStore } from '../store/textStore'
import { useKanbanStore } from '../store/kanbanStore'
import { useMediaStore } from '../store/mediaStore'
import { useDrawingStore } from '../store/drawingStore'
import { useReminderStore } from '../store/reminderStore'
import { useGridStore } from '../store/gridStore'
import { flushConnectionUpdate } from './Connections'
import { toPng } from 'html-to-image'
import { isTldraw } from '../config/canvas'
import { useTldrawEditor } from '../tldraw/TldrawCanvas'
import { useConnectionStore } from '../store/connectionStore'

/**
 * Temporarily neutralise any component-level `* zoom` styling so that
 * the export captures items at their natural (zoom-independent) sizes.
 * Components that multiply inline styles by zoom:
 *  - Checklist: fontSize, padding, borderRadius on the outer [data-node-id] div,
 *               and scaledFontSize on various inner elements
 * Returns a cleanup function that restores original values.
 */
function neutralizeZoomStyles(): () => void {
  const zoom = useGridStore.getState().zoom
  if (zoom === 1) return () => {}

  const saved: { el: HTMLElement; prop: string; value: string }[] = []

  function divideByZoom(el: HTMLElement, prop: 'fontSize' | 'padding' | 'borderRadius') {
    const val = el.style[prop]
    if (val) {
      saved.push({ el, prop, value: val })
      // Handle compound values like "20px 15px" in padding
      el.style[prop] = val.replace(/[\d.]+px/g, m => `${parseFloat(m) / zoom}px`)
    }
  }

  // Checklist components: outer [data-node-id] div carries inline fontSize, padding, borderRadius
  document.querySelectorAll('.checklist[class]').forEach(inner => {
    const outer = (inner as HTMLElement).closest('[data-node-id]') as HTMLElement
    if (outer) {
      divideByZoom(outer, 'fontSize')
      divideByZoom(outer, 'padding')
      divideByZoom(outer, 'borderRadius')
    }
    // Also fix any inner elements with inline fontSize
    inner.querySelectorAll<HTMLElement>('[style]').forEach(el => {
      divideByZoom(el, 'fontSize')
      divideByZoom(el, 'padding')
    })
  })

  // Force synchronous reflow so toPng sees the updated styles
  if (saved.length) void document.body.offsetHeight

  return () => {
    saved.forEach(({ el, prop, value }) => {
      ;(el.style as any)[prop] = value
    })
  }
}

/** Convert all cross-origin <img> elements inside a container to inline data-URL src
 *  so html-to-image won't be blocked by canvas tainting.  Returns a cleanup function
 *  that restores the original src values. */
async function inlineExternalImages(container: HTMLElement): Promise<() => void> {
  const imgs = Array.from(container.querySelectorAll('img')) as HTMLImageElement[]
  const originals: { img: HTMLImageElement; src: string }[] = []

  await Promise.all(
    imgs.map(async (img) => {
      // Skip already-inlined (data: or blob:) and same-origin images
      if (!img.src || img.src.startsWith('data:') || img.src.startsWith('blob:')) return
      try {
        const url = new URL(img.src)
        if (url.origin === window.location.origin) return
      } catch { return }

      try {
        const res = await fetch(img.src, { mode: 'cors', cache: 'force-cache' })
        const blob = await res.blob()
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onloadend = () => resolve(reader.result as string)
          reader.readAsDataURL(blob)
        })
        originals.push({ img, src: img.src })
        img.src = dataUrl
      } catch {
        // If CORS fetch fails, leave image as-is — imagePlaceholder will handle it
      }
    }),
  )

  return () => {
    originals.forEach(({ img, src }) => { img.src = src })
  }
}

export function ExportModal() {
  const { isExportModalOpen, closeExportModal } = useExportStore()
  const { currentBoardId, boards } = useBoardStore()
  const isDark = useThemeStore((state) => state.isDark)
  const [isExporting, setIsExporting] = useState(false)
  const [exportFormat, setExportFormat] = useState<'png'>('png')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const { notes } = useNoteStore()
  const { checklists } = useChecklistStore()
  const { texts } = useTextStore()
  const { boards: kanbanBoards } = useKanbanStore()
  const { medias } = useMediaStore()
  const { drawings } = useDrawingStore()
  const { reminders } = useReminderStore()
  const usingTldraw = isTldraw()
  const tldrawEditor = usingTldraw ? useTldrawEditor() : null

  const currentBoard = boards.find(b => b.id === currentBoardId)
  const boardName = currentBoard?.name || 'Untitled Board'

  // Get items for current board - filter by board membership
  const filteredNotes = notes.filter(n => currentBoard?.notes.includes(n.id))
  const filteredChecklists = checklists.filter(c => currentBoard?.checklists.includes(c.id))
  const filteredTexts = texts.filter(t => currentBoard?.texts.includes(t.id))
  const filteredKanbans = kanbanBoards.filter(k => currentBoard?.kanbans.includes(k.id))
  const filteredMedias = medias.filter(m => currentBoard?.medias.includes(m.id))
  const filteredDrawings = drawings.filter(d => currentBoard?.drawings.includes(d.id))
  const filteredReminders = reminders.filter(r => currentBoard?.reminders?.includes(r.id))
  const totalItems = filteredNotes.length + filteredChecklists.length + filteredTexts.length + filteredKanbans.length + filteredMedias.length + filteredDrawings.length + filteredReminders.length

  // Generate preview when modal opens
  useEffect(() => {
    if (isExportModalOpen) {
      if (usingTldraw && tldrawEditor) {
        generateTldrawPreview()
      } else {
        generatePreview()
      }
    } else {
      setPreviewUrl(null)
    }
  }, [isExportModalOpen])

  /* ── tldraw export helpers ── */

  /**
   * Build connection-line SVG paths and inject them into a tldraw SVG.
   * Returns a modified copy of the SVG element.
   */
  const injectConnectionLines = (
    svgEl: SVGSVGElement,
    editor: NonNullable<typeof tldrawEditor>,
    offsetX: number,
    offsetY: number,
  ) => {
    const conns = useConnectionStore.getState().connections
    const boardConns = conns.filter((c) => c.boardId === currentBoardId)
    if (boardConns.length === 0) return

    const shapes = editor.getCurrentPageShapes()

    // Build a lookup: itemId → { x, y, w, h } in page coords
    const lookup = new Map<string, { x: number; y: number; w: number; h: number }>()
    for (const shape of shapes) {
      const props = shape.props as Record<string, any>
      const itemId =
        props.noteId || props.textId || props.checklistId ||
        props.kanbanId || props.mediaId || props.reminderId || props.tableId
      if (itemId) {
        lookup.set(itemId, {
          x: shape.x,
          y: shape.y,
          w: (props.w as number) || 200,
          h: (props.h as number) || 200,
        })
      }
    }

    // Create an SVG <g> for all connection lines
    const ns = 'http://www.w3.org/2000/svg'
    const g = document.createElementNS(ns, 'g')
    g.setAttribute('class', 'connection-lines')

    for (const conn of boardConns) {
      const from = lookup.get(conn.fromId)
      const to = lookup.get(conn.toId)
      if (!from || !to) continue

      const fromCX = from.x + from.w / 2
      const fromCY = from.y + from.h / 2
      const toCX = to.x + to.w / 2
      const toCY = to.y + to.h / 2
      const dx = toCX - fromCX
      const dy = toCY - fromCY

      let fromX: number, fromY: number, toX: number, toY: number
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx > 0) { fromX = from.x + from.w; fromY = fromCY; toX = to.x; toY = toCY }
        else { fromX = from.x; fromY = fromCY; toX = to.x + to.w; toY = toCY }
      } else {
        if (dy > 0) { fromX = fromCX; fromY = from.y + from.h; toX = toCX; toY = to.y }
        else { fromX = fromCX; fromY = from.y; toX = toCX; toY = to.y + to.h }
      }

      // Translate from page coords to SVG coords (account for viewBox offset)
      fromX -= offsetX; fromY -= offsetY
      toX -= offsetX; toY -= offsetY

      const midX = (fromX + toX) / 2
      const midY = (fromY + toY) / 2
      const d = Math.abs(dx) > Math.abs(dy)
        ? `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`
        : `M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`

      const path = document.createElementNS(ns, 'path')
      path.setAttribute('d', d)
      path.setAttribute('stroke', conn.color || '#3b82f6')
      path.setAttribute('stroke-width', '2')
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke-linecap', 'round')
      g.appendChild(path)
    }

    // Insert connection lines BEFORE shape content so they render behind
    svgEl.insertBefore(g, svgEl.firstChild)
  }

  /**
   * Sanitise an SVG element so it can be drawn to a canvas without tainting.
   * Strips <foreignObject> (causes "the operation is insecure" on toDataURL)
   * and strips any <image> elements with non-data-URL hrefs.
   */
  const sanitiseSvgForCanvas = (svgEl: SVGSVGElement) => {
    svgEl.querySelectorAll('foreignObject').forEach(fo => fo.remove())
    svgEl.querySelectorAll('image').forEach(img => {
      const href = img.getAttribute('href') || img.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
      if (href && !href.startsWith('data:')) {
        img.remove()
      }
    })
  }

  /**
   * Convert an SVG element to a PNG data-URL via an offscreen canvas.
   */
  const svgToPngDataUrl = async (
    svgEl: SVGSVGElement,
    width: number,
    height: number,
    pixelRatio: number,
  ): Promise<string> => {
    // Strip elements that would taint the canvas
    sanitiseSvgForCanvas(svgEl)

    const svgString = new XMLSerializer().serializeToString(svgEl)
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const img = new Image()
    img.width = width
    img.height = height

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = reject
      img.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = width * pixelRatio
    canvas.height = height * pixelRatio
    const ctx = canvas.getContext('2d')!
    ctx.scale(pixelRatio, pixelRatio)
    ctx.drawImage(img, 0, 0, width, height)
    URL.revokeObjectURL(url)
    return canvas.toDataURL('image/png')
  }

  const generateTldrawPreview = async () => {
    if (!tldrawEditor) return
    try {
      const allShapeIds = tldrawEditor.getCurrentPageShapeIds()
      if (allShapeIds.size === 0) {
        setPreviewUrl(null)
        return
      }

      const result = await tldrawEditor.getSvgElement([...allShapeIds], {
        background: true,
        padding: 50,
        scale: 1,
      })
      if (!result) return

      const { svg, width, height } = result

      // Parse viewBox to get offset
      const vb = svg.getAttribute('viewBox')?.split(' ').map(Number) || [0, 0, width, height]

      injectConnectionLines(svg, tldrawEditor, vb[0], vb[1])

      // Display SVG directly as a data URL — avoids canvas tainting entirely
      try {
        const dataUrl = await svgToPngDataUrl(svg, width, height, 1)
        setPreviewUrl(dataUrl)
      } catch {
        // Fallback: show SVG directly if canvas approach fails
        const svgString = new XMLSerializer().serializeToString(svg)
        const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgString)}`
        setPreviewUrl(svgDataUrl)
      }
    } catch (error) {
      console.error('Error generating tldraw preview:', error)
    }
  }

  const handleTldrawExport = async () => {
    if (!tldrawEditor) return
    setIsExporting(true)
    try {
      const allShapeIds = tldrawEditor.getCurrentPageShapeIds()
      if (allShapeIds.size === 0) {
        setIsExporting(false)
        return
      }

      const result = await tldrawEditor.getSvgElement([...allShapeIds], {
        background: true,
        padding: 50,
        scale: 1,
      })
      if (!result) { setIsExporting(false); return }

      const { svg, width, height } = result
      const vb = svg.getAttribute('viewBox')?.split(' ').map(Number) || [0, 0, width, height]

      injectConnectionLines(svg, tldrawEditor, vb[0], vb[1])

      const filename = `${boardName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}`

      let dataUrl: string
      let ext = 'png'
      try {
        dataUrl = await svgToPngDataUrl(svg, width, height, 2)
      } catch {
        // Fallback: download as SVG if canvas tainting persists
        const svgString = new XMLSerializer().serializeToString(svg)
        const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' })
        dataUrl = URL.createObjectURL(svgBlob)
        ext = 'svg'
      }

      // Trigger download
      const link = document.createElement('a')
      link.download = `${filename}.${ext}`
      link.href = dataUrl
      link.click()
      if (ext === 'svg') URL.revokeObjectURL(dataUrl)

      closeExportModal()
    } catch (error) {
      console.error('Error exporting tldraw board:', error)
    } finally {
      setIsExporting(false)
    }
  }

  const generatePreview = async () => {
    // Temporarily neutralize zoom at the DOM level (bypasses React re-render timing)
    const itemsLayer = document.querySelector('[data-items-layer]') as HTMLElement
    const savedTransform = itemsLayer?.style.transform || ''
    if (itemsLayer) {
      itemsLayer.style.transform = 'scale(1)'
      void itemsLayer.offsetHeight // force synchronous reflow
    }
    const restoreZoomStyles = neutralizeZoomStyles()

    try {
      const canvasElement = document.querySelector('[data-board-canvas]') as HTMLElement
      if (!canvasElement) {
        console.error('Canvas element not found')
        return
      }

      // Calculate bounds from actual store data, not DOM positions
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      
      // Check all notes
      filteredNotes.forEach(note => {
        const element = document.querySelector(`[data-node-id="${note.id}"]`) as HTMLElement
        const width = element?.offsetWidth || 192
        const height = element?.offsetHeight || 128
        minX = Math.min(minX, note.position.x)
        minY = Math.min(minY, note.position.y)
        maxX = Math.max(maxX, note.position.x + width)
        maxY = Math.max(maxY, note.position.y + height)
      })

      // Check all checklists
      filteredChecklists.forEach(checklist => {
        const element = document.querySelector(`[data-node-id="${checklist.id}"]`) as HTMLElement
        const width = element?.offsetWidth || 300
        const height = element?.offsetHeight || 200
        minX = Math.min(minX, checklist.position.x)
        minY = Math.min(minY, checklist.position.y)
        maxX = Math.max(maxX, checklist.position.x + width)
        maxY = Math.max(maxY, checklist.position.y + height)
      })

      // Check all texts
      filteredTexts.forEach(text => {
        const element = document.querySelector(`[data-node-id="${text.id}"]`) as HTMLElement
        const width = element?.offsetWidth || 200
        const height = element?.offsetHeight || 100
        minX = Math.min(minX, text.position.x)
        minY = Math.min(minY, text.position.y)
        maxX = Math.max(maxX, text.position.x + width)
        maxY = Math.max(maxY, text.position.y + height)
      })

      // Check all kanbans
      filteredKanbans.forEach(kanban => {
        const element = document.querySelector(`[data-node-id="${kanban.id}"]`) as HTMLElement
        const width = element?.offsetWidth || 800
        const height = element?.offsetHeight || 400
        minX = Math.min(minX, kanban.position.x)
        minY = Math.min(minY, kanban.position.y)
        maxX = Math.max(maxX, kanban.position.x + width)
        maxY = Math.max(maxY, kanban.position.y + height)
      })

      // Check all media items
      filteredMedias.forEach(media => {
        const element = document.querySelector(`[data-node-id="${media.id}"]`) as HTMLElement
        const actualWidth = media.type === 'video' ? (media.width || 300) * 0.7 : (media.width || 250)
        const width = element?.offsetWidth || actualWidth
        const height = element?.offsetHeight || media.height || 300
        minX = Math.min(minX, media.position.x)
        minY = Math.min(minY, media.position.y)
        maxX = Math.max(maxX, media.position.x + width)
        maxY = Math.max(maxY, media.position.y + height)
      })

      // Check all drawings
      filteredDrawings.forEach(drawing => {
        drawing.paths.forEach(path => {
          path.points.forEach(point => {
            minX = Math.min(minX, point.x)
            minY = Math.min(minY, point.y)
            maxX = Math.max(maxX, point.x)
            maxY = Math.max(maxY, point.y)
          })
        })
      })

      // Check all reminders
      filteredReminders.forEach(reminder => {
        const element = document.querySelector(`[data-node-id="${reminder.id}"]`) as HTMLElement
        const width = element?.offsetWidth || 280
        const height = element?.offsetHeight || 200
        minX = Math.min(minX, reminder.position.x)
        minY = Math.min(minY, reminder.position.y)
        maxX = Math.max(maxX, reminder.position.x + width)
        maxY = Math.max(maxY, reminder.position.y + height)
      })

      // If no items, use default bounds
      if (!isFinite(minX)) {
        minX = 0
        minY = 0
        maxX = 800
        maxY = 600
      }

      const padding = 100
      const width = maxX - minX + padding * 2
      const height = maxY - minY + padding * 2

      console.log('Preview bounds:', { width, height, minX, minY, maxX, maxY, totalItems })

      if (width <= 0 || height <= 0) {
        console.error('Invalid dimensions', { width, height })
        return
      }

      // Scroll to top-left to reset connection line positions
      const scrollContainer = document.querySelector('.fixed.inset-0.overflow-auto') as HTMLElement
      const originalScrollTop = scrollContainer?.scrollTop || 0
      const originalScrollLeft = scrollContainer?.scrollLeft || 0
      
      if (scrollContainer) {
        scrollContainer.scrollTop = 0
        scrollContainer.scrollLeft = 0
      }

      // Wait for layout to settle
      await new Promise(resolve => setTimeout(resolve, 200))

      // Force connection lines to recalculate at new layout positions
      flushConnectionUpdate()

      // Pre-convert cross-origin images to data URLs
      const restoreImages = await inlineExternalImages(canvasElement)

      const preview = await toPng(canvasElement, {
        backgroundColor: isDark ? '#18181b' : '#ffffff',
        width: width,
        height: height,
        style: {
          // Break out of fixed viewport size so content isn't clipped
          position: 'static',
          width: 'auto',
          height: 'auto',
          overflow: 'visible',
          transform: `translate(${-(minX - padding)}px, ${-(minY - padding)}px)`,
        },
        pixelRatio: 1,
        cacheBust: true,
        skipAutoScale: true,
        imagePlaceholder: 'data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect fill="%23f0f0f0" width="200" height="150"/><text x="100" y="75" text-anchor="middle" fill="%23999" font-size="14">Image</text></svg>',
        filter: (node) => {
          if (node.tagName === 'IFRAME') return false
          // Skip fixed UI overlays that shouldn't be in export, but keep connection lines
          const el = node as HTMLElement
          if (el.hasAttribute?.('data-board-connections')) return true
          if (el.closest?.('[data-board-connections]')) return true
          if (el.style?.position === 'fixed') return false
          if (el.classList?.contains('fixed')) return false
          return true
        },
      })

      restoreImages()

      // Restore scroll position
      if (scrollContainer) {
        scrollContainer.scrollTop = originalScrollTop
        scrollContainer.scrollLeft = originalScrollLeft
      }

      setPreviewUrl(preview)
    } catch (error) {
      console.error('Error generating preview:', error)
    } finally {
      // Always restore zoom styles, even on error
      restoreZoomStyles()
      if (itemsLayer) {
        itemsLayer.style.transform = savedTransform
      }
      // Restore connection line positions after zoom/scroll restore
      flushConnectionUpdate()
    }
  }

  const handleExport = async () => {
    setIsExporting(true)
    // Temporarily neutralize zoom at the DOM level (bypasses React re-render timing)
    const itemsLayer = document.querySelector('[data-items-layer]') as HTMLElement
    const savedTransform = itemsLayer?.style.transform || ''
    if (itemsLayer) {
      itemsLayer.style.transform = 'scale(1)'
      void itemsLayer.offsetHeight // force synchronous reflow
    }
    const restoreZoomStyles = neutralizeZoomStyles()

    try {
      const canvasElement = document.querySelector('[data-board-canvas]') as HTMLElement
      
      if (!canvasElement) {
        console.error('Canvas element not found')
        setIsExporting(false)
        return
      }

      // Calculate bounds from actual store data and element sizes
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      
      // Check all notes
      filteredNotes.forEach(note => {
        const element = document.querySelector(`[data-node-id="${note.id}"]`) as HTMLElement
        const width = element?.offsetWidth || 192
        const height = element?.offsetHeight || 128
        minX = Math.min(minX, note.position.x)
        minY = Math.min(minY, note.position.y)
        maxX = Math.max(maxX, note.position.x + width)
        maxY = Math.max(maxY, note.position.y + height)
      })

      // Check all checklists
      filteredChecklists.forEach(checklist => {
        const element = document.querySelector(`[data-node-id="${checklist.id}"]`) as HTMLElement
        const width = element?.offsetWidth || 300
        const height = element?.offsetHeight || 200
        minX = Math.min(minX, checklist.position.x)
        minY = Math.min(minY, checklist.position.y)
        maxX = Math.max(maxX, checklist.position.x + width)
        maxY = Math.max(maxY, checklist.position.y + height)
      })

      // Check all texts
      filteredTexts.forEach(text => {
        const element = document.querySelector(`[data-node-id="${text.id}"]`) as HTMLElement
        const width = element?.offsetWidth || 200
        const height = element?.offsetHeight || 100
        minX = Math.min(minX, text.position.x)
        minY = Math.min(minY, text.position.y)
        maxX = Math.max(maxX, text.position.x + width)
        maxY = Math.max(maxY, text.position.y + height)
      })

      // Check all kanbans
      filteredKanbans.forEach(kanban => {
        const element = document.querySelector(`[data-node-id="${kanban.id}"]`) as HTMLElement
        const width = element?.offsetWidth || 800
        const height = element?.offsetHeight || 400
        minX = Math.min(minX, kanban.position.x)
        minY = Math.min(minY, kanban.position.y)
        maxX = Math.max(maxX, kanban.position.x + width)
        maxY = Math.max(maxY, kanban.position.y + height)
      })

      // Check all drawings
      filteredDrawings.forEach(drawing => {
        drawing.paths.forEach(path => {
          path.points.forEach(point => {
            minX = Math.min(minX, point.x)
            minY = Math.min(minY, point.y)
            maxX = Math.max(maxX, point.x)
            maxY = Math.max(maxY, point.y)
          })
        })
      })

      // Check all media items
      filteredMedias.forEach(media => {
        const element = document.querySelector(`[data-node-id="${media.id}"]`) as HTMLElement
        const actualWidth = media.type === 'video' ? (media.width || 300) * 0.7 : (media.width || 250)
        const width = element?.offsetWidth || actualWidth
        const height = element?.offsetHeight || media.height || 300
        minX = Math.min(minX, media.position.x)
        minY = Math.min(minY, media.position.y)
        maxX = Math.max(maxX, media.position.x + width)
        maxY = Math.max(maxY, media.position.y + height)
      })

      // Check all reminders
      filteredReminders.forEach(reminder => {
        const element = document.querySelector(`[data-node-id="${reminder.id}"]`) as HTMLElement
        const width = element?.offsetWidth || 280
        const height = element?.offsetHeight || 200
        minX = Math.min(minX, reminder.position.x)
        minY = Math.min(minY, reminder.position.y)
        maxX = Math.max(maxX, reminder.position.x + width)
        maxY = Math.max(maxY, reminder.position.y + height)
      })

      // If no items, show error
      if (!isFinite(minX)) {
        console.error('No items to export')
        setIsExporting(false)
        return
      }

      const padding = 100
      const exportWidth = maxX - minX + padding * 2
      const exportHeight = maxY - minY + padding * 2

      console.log('Export dimensions:', { exportWidth, exportHeight, minX, minY, maxX, maxY, totalItems })

      if (exportWidth <= 0 || exportHeight <= 0) {
        console.error('Invalid export dimensions', { exportWidth, exportHeight })
        setIsExporting(false)
        return
      }

      // Scroll to top-left to reset connection line positions
      const scrollContainer = document.querySelector('.fixed.inset-0.overflow-auto') as HTMLElement
      const originalScrollTop = scrollContainer?.scrollTop || 0
      const originalScrollLeft = scrollContainer?.scrollLeft || 0
      
      if (scrollContainer) {
        scrollContainer.scrollTop = 0
        scrollContainer.scrollLeft = 0
      }

      // Wait for layout to settle
      await new Promise(resolve => setTimeout(resolve, 200))

      // Pre-convert cross-origin images to data URLs
      const restoreImages = await inlineExternalImages(canvasElement)

      // Force connection lines to recalculate at new layout positions
      flushConnectionUpdate()

      // Export the canvas with calculated dimensions
      const dataUrl = await toPng(canvasElement, {
        backgroundColor: isDark ? '#18181b' : '#ffffff',
        width: exportWidth,
        height: exportHeight,
        style: {
          // Break out of fixed viewport size so content isn't clipped
          position: 'static',
          width: 'auto',
          height: 'auto',
          overflow: 'visible',
          transform: `translate(${-(minX - padding)}px, ${-(minY - padding)}px)`,
        },
        pixelRatio: 2,
        cacheBust: true,
        skipAutoScale: true,
        imagePlaceholder: 'data:image/svg+xml;charset=utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect fill="%23f0f0f0" width="200" height="150"/><text x="100" y="75" text-anchor="middle" fill="%23999" font-size="14">Image</text></svg>',
        filter: (node) => {
          if (node.tagName === 'IFRAME') return false
          const el = node as HTMLElement
          if (el.hasAttribute?.('data-board-connections')) return true
          if (el.closest?.('[data-board-connections]')) return true
          if (el.style?.position === 'fixed') return false
          if (el.classList?.contains('fixed')) return false
          return true
        },
      })

      restoreImages()

      // Restore scroll position
      if (scrollContainer) {
        scrollContainer.scrollTop = originalScrollTop
        scrollContainer.scrollLeft = originalScrollLeft
      }

      // Download the image
      const link = document.createElement('a')
      link.download = `${boardName.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.${exportFormat}`
      link.href = dataUrl
      link.click()

      setIsExporting(false)
      closeExportModal()
    } catch (error) {
      console.error('Error exporting board:', error)
      setIsExporting(false)
    } finally {
      // Always restore zoom styles, even on error
      restoreZoomStyles()
      if (itemsLayer) {
        itemsLayer.style.transform = savedTransform
      }
      // Restore connection line positions after zoom/scroll restore
      flushConnectionUpdate()
    }
  }

  if (!isExportModalOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className={`relative w-[90vw] max-w-5xl h-[80vh] rounded-2xl shadow-2xl overflow-hidden
        ${isDark 
          ? 'bg-zinc-900 border border-zinc-800' 
          : 'bg-white border border-zinc-200'}`}>
        
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b
          ${isDark ? 'border-zinc-800' : 'border-zinc-200'}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl
              ${isDark ? 'bg-blue-500/10' : 'bg-blue-50'}`}>
              <Download className={`w-5 h-5
                ${isDark ? 'text-blue-400' : 'text-blue-600'}`} />
            </div>
            <div>
              <h2 className={`text-xl font-semibold
                ${isDark ? 'text-zinc-100' : 'text-zinc-900'}`}>
                Export Board
              </h2>
              <p className={`text-sm
                ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                {boardName}
              </p>
            </div>
          </div>
          <button
            onClick={closeExportModal}
            className={`p-2 rounded-lg transition-colors
              ${isDark 
                ? 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200' 
                : 'hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900'}`}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex h-[calc(100%-140px)]">
          {/* Left: Preview */}
          <div className={`flex-1 p-6 border-r overflow-auto
            ${isDark ? 'border-zinc-800 bg-zinc-900/50' : 'border-zinc-200 bg-zinc-50'}`}>
            {previewUrl ? (
              <div className="w-full flex items-start justify-center">
                <img 
                  src={previewUrl} 
                  alt="Export preview" 
                  className="max-w-full rounded-lg shadow-lg"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full">
                <div className={`w-full max-w-md aspect-video rounded-xl border-2 border-dashed flex items-center justify-center
                  ${isDark ? 'border-zinc-700 bg-zinc-800/50' : 'border-zinc-300 bg-white'}`}>
                  <div className="text-center space-y-3">
                    <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center
                      ${isDark ? 'bg-zinc-700/50' : 'bg-zinc-200'}`}>
                      <Loader2 className={`w-8 h-8 animate-spin
                        ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`} />
                    </div>
                    <div>
                      <p className={`text-sm font-medium
                        ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                        Generating Preview...
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Options */}
          <div className="w-80 p-6 space-y-6">
            <div>
              <h3 className={`text-sm font-semibold mb-3
                ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                Export Details
              </h3>
              <div className="space-y-3">
                <div className={`p-3 rounded-lg
                  ${isDark ? 'bg-zinc-800/50' : 'bg-zinc-100'}`}>
                  <p className={`text-xs font-medium mb-1
                    ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Board Name
                  </p>
                  <p className={`text-sm font-medium
                    ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                    {boardName}
                  </p>
                </div>

                {/* <div className={`p-3 rounded-lg
                  ${isDark ? 'bg-zinc-800/50' : 'bg-zinc-100'}`}>
                  <p className={`text-xs font-medium mb-1
                    ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Items Count
                  </p>
                  <p className={`text-sm font-medium
                    ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                    {totalItems} items
                  </p>
                </div> */}

                <div className={`p-3 rounded-lg
                  ${isDark ? 'bg-zinc-800/50' : 'bg-zinc-100'}`}>
                  <p className={`text-xs font-medium mb-1
                    ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Format
                  </p>
                  <p className={`text-sm font-medium, drawings
                    ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
                    PNG (2x quality)
                  </p>
                </div>
              </div>
            </div>

            <div className={`p-4 rounded-xl border
              ${isDark ? 'bg-blue-500/5 border-blue-500/20' : 'bg-blue-50 border-blue-200'}`}>
              <p className={`text-xs leading-relaxed
                ${isDark ? 'text-blue-300' : 'text-blue-700'}`}>
                <strong>Note:</strong> The export includes all board items (sticky notes, tasks, checklists, text, connections) including those outside the visible viewport. UI elements (dock, sidebar) are excluded.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`absolute bottom-0 left-0 right-0 px-6 py-4 border-t flex items-center justify-between
          ${isDark ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-white'}`}>
          <button
            onClick={closeExportModal}
            className={`px-4 py-2 rounded-lg font-medium transition-colors
              ${isDark 
                ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800' 
                : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}`}
          >
            Cancel
          </button>
          <button
            onClick={usingTldraw ? handleTldrawExport : handleExport}
            disabled={isExporting}
            className={`px-6 py-2 rounded-lg font-semibold transition-all flex items-center gap-2
              ${isDark 
                ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                : 'bg-blue-600 hover:bg-blue-700 text-white'}
              disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Export as PNG
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
