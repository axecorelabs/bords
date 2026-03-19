'use client'
import { useState, useEffect, useRef } from 'react'
import { Pencil, Eraser, ZoomIn, ZoomOut, MousePointer2, Hand, ArrowUpRight, Highlighter, Shapes, Minus, Square, Circle as CircleIcon, Triangle, Diamond } from 'lucide-react'
import { useThemeStore } from '../store/themeStore'
import { useTldrawEditor } from '../tldraw/TldrawCanvas'
import { GeoShapeGeoStyle } from 'tldraw'

/**
 * Minimal vertical side dock shown only in presentation mode.
 * Uses native tldraw tools: select, hand, draw, eraser, arrow, highlight, shapes + zoom.
 */
export function PresentationDock() {
  const isDark = useThemeStore((s) => s.isDark)
  const tldrawEditor = useTldrawEditor()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [activeTool, setActiveTool] = useState('select')
  const [tldrawZoom, setTldrawZoom] = useState(1)
  const [showShapesMenu, setShowShapesMenu] = useState(false)
  const [activeGeoShape, setActiveGeoShape] = useState('rectangle')
  const shapesMenuRef = useRef<HTMLDivElement>(null)

  // Track active tldraw tool
  useEffect(() => {
    if (!tldrawEditor) return
    const interval = setInterval(() => {
      try {
        const toolId = tldrawEditor.getCurrentToolId()
        setActiveTool(prev => prev !== toolId ? toolId : prev)
        const z = tldrawEditor.getZoomLevel()
        setTldrawZoom(prev => Math.abs(prev - z) > 0.005 ? z : prev)
      } catch { /* editor may be unmounted */ }
    }, 200)
    return () => clearInterval(interval)
  }, [tldrawEditor])

  // Close shapes menu on outside click
  useEffect(() => {
    if (!showShapesMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      if (shapesMenuRef.current && !shapesMenuRef.current.contains(e.target as Node)) {
        setShowShapesMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showShapesMenu])

  const handleZoomIn = () => tldrawEditor?.zoomIn()
  const handleZoomOut = () => tldrawEditor?.zoomOut()
  const handleZoomReset = () => tldrawEditor?.resetZoom()

  const tools = [
    {
      id: 'select',
      icon: MousePointer2,
      label: 'Select (V)',
      onClick: () => tldrawEditor?.setCurrentTool('select'),
      isActive: activeTool === 'select',
      activeColor: 'text-blue-500',
    },
    {
      id: 'hand',
      icon: Hand,
      label: 'Hand (H)',
      onClick: () => tldrawEditor?.setCurrentTool('hand'),
      isActive: activeTool === 'hand',
      activeColor: 'text-blue-500',
    },
    {
      id: 'draw',
      icon: Pencil,
      label: 'Draw (D)',
      onClick: () => tldrawEditor?.setCurrentTool('draw'),
      isActive: activeTool === 'draw',
      activeColor: 'text-blue-500',
    },
    {
      id: 'eraser',
      icon: Eraser,
      label: 'Eraser (E)',
      onClick: () => tldrawEditor?.setCurrentTool('eraser'),
      isActive: activeTool === 'eraser',
      activeColor: 'text-orange-500',
    },
    {
      id: 'arrow',
      icon: ArrowUpRight,
      label: 'Arrow',
      onClick: () => tldrawEditor?.setCurrentTool('arrow'),
      isActive: activeTool === 'arrow',
      activeColor: 'text-green-500',
    },
    {
      id: 'highlight',
      icon: Highlighter,
      label: 'Highlight',
      onClick: () => tldrawEditor?.setCurrentTool('highlight'),
      isActive: activeTool === 'highlight',
      activeColor: 'text-yellow-500',
    },
    {
      id: 'shapes',
      icon: Shapes,
      label: 'Shapes',
      onClick: () => setShowShapesMenu(!showShapesMenu),
      isActive: ['geo', 'line'].includes(activeTool),
      activeColor: 'text-purple-500',
    },
    {
      id: 'zoom-out',
      icon: ZoomOut,
      label: `Zoom Out (${Math.round(tldrawZoom * 100)}%)`,
      onClick: handleZoomOut,
      isActive: false,
      activeColor: '',
    },
    {
      id: 'zoom-reset',
      label: `${Math.round(tldrawZoom * 100)}%`,
      onClick: handleZoomReset,
      isActive: false,
      activeColor: '',
      isText: true,
    },
    {
      id: 'zoom-in',
      icon: ZoomIn,
      label: `Zoom In (${Math.round(tldrawZoom * 100)}%)`,
      onClick: handleZoomIn,
      isActive: false,
      activeColor: '',
    },
  ] as const

  const shapeOptions = [
    { id: 'line', icon: Minus, label: 'Line', color: 'text-blue-500', onClick: () => { tldrawEditor?.setCurrentTool('line'); setShowShapesMenu(false) } },
    { id: 'rectangle', icon: Square, label: 'Rectangle', color: 'text-purple-500', onClick: () => { if (!tldrawEditor) return; tldrawEditor.setStyleForNextShapes(GeoShapeGeoStyle, 'rectangle'); tldrawEditor.setCurrentTool('geo'); setActiveGeoShape('rectangle'); setShowShapesMenu(false) } },
    { id: 'ellipse', icon: CircleIcon, label: 'Ellipse', color: 'text-purple-500', onClick: () => { if (!tldrawEditor) return; tldrawEditor.setStyleForNextShapes(GeoShapeGeoStyle, 'ellipse'); tldrawEditor.setCurrentTool('geo'); setActiveGeoShape('ellipse'); setShowShapesMenu(false) } },
    { id: 'triangle', icon: Triangle, label: 'Triangle', color: 'text-purple-500', onClick: () => { if (!tldrawEditor) return; tldrawEditor.setStyleForNextShapes(GeoShapeGeoStyle, 'triangle'); tldrawEditor.setCurrentTool('geo'); setActiveGeoShape('triangle'); setShowShapesMenu(false) } },
    { id: 'diamond', icon: Diamond, label: 'Diamond', color: 'text-purple-500', onClick: () => { if (!tldrawEditor) return; tldrawEditor.setStyleForNextShapes(GeoShapeGeoStyle, 'diamond'); tldrawEditor.setCurrentTool('geo'); setActiveGeoShape('diamond'); setShowShapesMenu(false) } },
  ]

  return (
    <div
      className={`fixed right-4 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-1.5 p-2 rounded-2xl border shadow-xl backdrop-blur-xl transition-colors duration-200 ${
        isDark
          ? 'bg-zinc-800/90 border-zinc-700/50'
          : 'bg-white/90 border-zinc-200/50'
      }`}
    >
      {tools.map((tool) => (
        <div key={tool.id} className="relative">
          <button
            onClick={tool.onClick}
            onPointerEnter={(e) => { if (e.pointerType !== 'touch') setHoveredId(tool.id) }}
            onPointerLeave={(e) => { if (e.pointerType !== 'touch') setHoveredId(null) }}
            onTouchEnd={() => setHoveredId(null)}
            className={`relative p-2.5 rounded-xl transition-all duration-200 ${
              tool.isActive
                ? `${tool.activeColor} ${isDark ? 'bg-zinc-700/60' : 'bg-zinc-100'}`
                : isDark
                  ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                  : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            {'isText' in tool && tool.isText ? (
              <span className="text-[10px] font-bold min-w-[18px] text-center block">{tool.label}</span>
            ) : 'icon' in tool && tool.icon ? (
              <tool.icon size={18} strokeWidth={1.5} />
            ) : null}

            {/* Tooltip — left side */}
            <div
              className={`absolute right-full top-1/2 -translate-y-1/2 mr-3 whitespace-nowrap
                bg-zinc-800 text-white px-2.5 py-1 rounded-lg text-xs font-medium
                pointer-events-none shadow-lg transition-all duration-150
                ${hoveredId === tool.id ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
              `}
            >
              {tool.label}
              <div className="absolute top-1/2 -translate-y-1/2 -right-1 border-4 border-transparent border-l-zinc-800" />
            </div>
          </button>

          {/* Shapes sub-menu */}
          {tool.id === 'shapes' && showShapesMenu && (
            <div
              ref={shapesMenuRef}
              className={`absolute right-full top-0 mr-3 p-2 rounded-xl border shadow-xl backdrop-blur-xl z-50 ${
                isDark ? 'bg-zinc-800/95 border-zinc-700/50' : 'bg-white/95 border-zinc-200/50'
              }`}
            >
              <div className="flex flex-col gap-1">
                {shapeOptions.map((shape) => (
                  <button
                    key={shape.id}
                    onClick={shape.onClick}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                      (activeTool === 'geo' && activeGeoShape === shape.id) || (activeTool === 'line' && shape.id === 'line')
                        ? `${shape.color} ${isDark ? 'bg-zinc-700/60' : 'bg-zinc-100'}`
                        : isDark
                          ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                          : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
                    }`}
                  >
                    <shape.icon size={16} strokeWidth={1.5} />
                    {shape.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
