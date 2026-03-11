'use client'

import { useEffect, useState, use, useMemo } from 'react'
import { Loader2, Lock, Check, Clock, ChevronDown } from 'lucide-react'

/* ─────────────── Types mirroring the cloud document ─────────────── */

interface Position { x: number; y: number }

interface ChecklistItem {
  id: string; text: string; completed: boolean
  deadline?: string; timeSpent?: number
}
interface CloudChecklist {
  id: string; title: string; items: ChecklistItem[]
  position: Position; color: string
  width?: number; height?: number
}

interface KanbanTask {
  id: string; title: string; description?: string
  priority?: 'low' | 'medium' | 'high'; dueDate?: string; completed?: boolean
}
interface KanbanColumn { id: string; title: string; tasks: KanbanTask[] }
interface CloudKanban {
  id: string; title: string; columns: KanbanColumn[]
  position: Position; color: string; width?: number; height?: number
}

interface CloudNote {
  id: string; text: string; position: Position; color: string
  width?: number; height?: number
}

interface CloudMedia {
  id: string; url: string; title?: string; description?: string
  type: 'image' | 'video'; position: Position; width: number; height: number
  color?: string
}

interface CloudText {
  id: string; text: string; position: Position
  fontSize: number; color: string; rotation?: number
}

interface DrawingPath {
  id: string; points: { x: number; y: number; pressure?: number }[]
  color: string; strokeWidth: number
}
interface CloudDrawing {
  id: string; paths: DrawingPath[]; position: Position
}

interface CloudConnection {
  id: string; fromId: string; toId: string; color: string
  fromType?: string; toType?: string
  fromPosition?: Position; toPosition?: Position
}

/** Bounding rect used for connection endpoint calculation */
interface ItemRect { x: number; y: number; w: number; h: number }

interface CloudBoard {
  name: string
  backgroundImage?: string
  backgroundColor?: string
  backgroundOverlay?: boolean
  backgroundOverlayColor?: string
  backgroundBlurLevel?: string
  checklists: CloudChecklist[]
  kanbanBoards: CloudKanban[]
  stickyNotes: CloudNote[]
  mediaItems: CloudMedia[]
  textElements: CloudText[]
  drawings: CloudDrawing[]
  connections: CloudConnection[]
  gridSettings?: { gridColor: string; isGridVisible: boolean; gridSize: number }
  themeSettings?: { isDark: boolean }
}

/* ─────────────── Read-only canvas components ─────────────── */

function ReadOnlyNote({ note }: { note: CloudNote }) {
  return (
    <div
      className={`absolute ${note.color || 'bg-yellow-200'} rounded-2xl shadow-lg border border-black/10 p-4 overflow-hidden`}
      style={{
        left: note.position.x, top: note.position.y,
        width: note.width || 192, height: note.height || 'auto',
        minHeight: 80
      }}
    >
      <p className="text-gray-800 text-sm whitespace-pre-wrap break-words leading-relaxed">
        {note.text}
      </p>
    </div>
  )
}

function ReadOnlyChecklist({ cl }: { cl: CloudChecklist }) {
  const items = cl.items || []
  const completedCount = items.filter(i => i.completed).length
  return (
    <div
      className={`absolute ${cl.color || 'bg-white/70'} backdrop-blur-md rounded-3xl border border-black/10 shadow-lg p-5 overflow-hidden`}
      style={{
        left: cl.position.x, top: cl.position.y,
        width: cl.width || 320, height: cl.height || 'auto',
      }}
    >
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold text-gray-800">{cl.title}</h3>
        <span className="text-xs text-gray-500 bg-white/60 rounded-full px-2 py-0.5">
          {completedCount}/{items.length}
        </span>
      </div>
      <div className="space-y-2">
        {items.map(item => (
          <div key={item.id} className="flex items-start gap-2 bg-white/60 rounded-xl p-2.5 border border-white/50">
            <div className={`p-1 rounded-md mt-0.5 flex-shrink-0 ${
              item.completed ? 'bg-green-500 text-white' : 'bg-white/80 border border-black/10'
            }`}>
              <Check size={12} className={item.completed ? '' : 'text-gray-400'} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium leading-snug ${
                item.completed ? 'text-gray-400 line-through' : 'text-gray-800'
              }`}>
                {item.text}
              </p>
              {item.deadline && (
                <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-500">
                  <Clock size={10} className="text-blue-400" />
                  <span>{new Date(item.deadline).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReadOnlyKanban({ kb }: { kb: CloudKanban }) {
  return (
    <div
      className={`absolute ${kb.color || 'bg-white/70'} backdrop-blur-md rounded-3xl border border-black/10 shadow-lg p-5 overflow-hidden`}
      style={{
        left: kb.position.x, top: kb.position.y,
        width: kb.width || 700, height: kb.height || 'auto',
      }}
    >
      <h3 className="text-lg font-semibold text-gray-800 mb-4">{kb.title}</h3>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {kb.columns.map(col => (
          <div key={col.id} className="min-w-[180px] flex-1 bg-white/40 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider">{col.title}</h4>
              <span className="text-[10px] text-gray-400 bg-white/60 rounded-full px-1.5">{(col.tasks || []).length}</span>
            </div>
            <div className="space-y-2">
              {(col.tasks || []).map(task => (
                <div key={task.id} className="bg-white/80 rounded-xl p-3 border border-white/50 shadow-sm">
                  <p className={`text-sm font-medium ${task.completed ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                    {task.title}
                  </p>
                  {task.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>
                  )}
                  <div className="flex items-center gap-1.5 mt-2">
                    {task.priority && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium ${
                        task.priority === 'high' ? 'bg-red-100 text-red-600' :
                        task.priority === 'medium' ? 'bg-amber-100 text-amber-600' :
                        'bg-blue-100 text-blue-600'
                      }`}>
                        {task.priority}
                      </span>
                    )}
                    {task.dueDate && (
                      <span className="text-[10px] text-gray-400">
                        {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReadOnlyText({ t }: { t: CloudText }) {
  return (
    <div
      className="absolute whitespace-pre-wrap break-words"
      style={{
        left: t.position.x, top: t.position.y,
        fontSize: t.fontSize, color: t.color,
        transform: t.rotation ? `rotate(${t.rotation}deg)` : undefined,
      }}
    >
      {t.text}
    </div>
  )
}

function ReadOnlyMedia({ m }: { m: CloudMedia }) {
  return (
    <div
      className="absolute rounded-2xl overflow-hidden shadow-lg border border-black/10"
      style={{
        left: m.position.x, top: m.position.y,
        width: m.width || 300, height: m.height || 200,
      }}
    >
      {m.type === 'image' ? (
        <img src={m.url} alt={m.title || ''} className="w-full h-full object-cover" />
      ) : (
        <video src={m.url} controls className="w-full h-full object-cover" />
      )}
    </div>
  )
}

function ReadOnlyDrawing({ d }: { d: CloudDrawing }) {
  if (!d.paths?.length) return null
  // Calculate bounding box of all paths
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const path of d.paths) {
    for (const pt of path.points) {
      if (pt.x < minX) minX = pt.x
      if (pt.y < minY) minY = pt.y
      if (pt.x > maxX) maxX = pt.x
      if (pt.y > maxY) maxY = pt.y
    }
  }
  const pad = 20
  const w = maxX - minX + pad * 2
  const h = maxY - minY + pad * 2

  return (
    <svg
      className="absolute pointer-events-none"
      style={{ left: d.position.x + minX - pad, top: d.position.y + minY - pad, width: w, height: h }}
      viewBox={`${minX - pad} ${minY - pad} ${w} ${h}`}
    >
      {d.paths.map(path => {
        if (path.points.length < 2) return null
        const d_attr = path.points.reduce((acc, pt, i) =>
          i === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`, '')
        return (
          <path
            key={path.id}
            d={d_attr}
            stroke={path.color}
            strokeWidth={path.strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )
      })}
    </svg>
  )
}

function ReadOnlyConnections({ connections, items }: { connections: CloudConnection[]; items: Map<string, ItemRect> }) {
  if (!connections?.length) return null

  // Calculate the full bounding box of all connected items so the SVG covers the whole canvas
  let maxX = 0, maxY = 0
  items.forEach(rect => {
    const right = rect.x + rect.w + 100  // padding
    const bottom = rect.y + rect.h + 100
    if (right > maxX) maxX = right
    if (bottom > maxY) maxY = bottom
  })

  return (
    <svg
      className="absolute top-0 left-0 pointer-events-none"
      style={{ width: maxX, height: maxY, overflow: 'visible', zIndex: 0 }}
    >
      {connections.map(conn => {
        const fromRect = items.get(conn.fromId)
        const toRect = items.get(conn.toId)
        if (!fromRect || !toRect) return null

        // Calculate center of each item
        const fromCx = fromRect.x + fromRect.w / 2
        const fromCy = fromRect.y + fromRect.h / 2
        const toCx = toRect.x + toRect.w / 2
        const toCy = toRect.y + toRect.h / 2

        // Determine connection side: connect from the edge closest to the other item
        // (mimics the real system where the indicator sits on left or right edge at vertical center)
        const fromIsLeft = toCx < fromCx
        const toIsLeft = fromCx < toCx

        const fromX = fromIsLeft ? fromRect.x : fromRect.x + fromRect.w
        const fromY = fromCy
        const toX = toIsLeft ? toRect.x : toRect.x + toRect.w
        const toY = toCy

        // Bezier curve — same formula as the real board's ConnectionLine
        const midX = (fromX + toX) / 2
        const d = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`

        return (
          <path
            key={conn.id}
            d={d}
            stroke={conn.color || '#3b82f6'}
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
          />
        )
      })}
    </svg>
  )
}

/* ─────────────── Grid background (read-only) ─────────────── */

function ReadOnlyGrid({ gridColor, gridSize }: { gridColor: string; gridSize: number }) {
  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{
        height: '3000px',
        backgroundImage: `
          linear-gradient(to right, ${gridColor} 1px, transparent 1px),
          linear-gradient(to bottom, ${gridColor} 1px, transparent 1px)
        `,
        backgroundSize: `${gridSize * 2}px ${gridSize * 2}px`,
      }}
    />
  )
}

/* ─────────────── Main Page ─────────────── */

interface SharedBoardPageProps {
  params: Promise<{ token: string }>
}

export default function SharedBoardPage({ params }: SharedBoardPageProps) {
  const { token } = use(params)
  const [board, setBoard] = useState<CloudBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/boards/public/${token}`)
        if (!res.ok) {
          const err = await res.json()
          setError(err.error || 'Board not found')
          return
        }
        const data = await res.json()
        setBoard(data.board)
      } catch {
        setError('Failed to load board')
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  // Build a rect lookup map for connections (position + dimensions)
  const itemRectMap = useMemo(() => {
    if (!board) return new Map<string, ItemRect>()
    const map = new Map<string, ItemRect>()
    board.stickyNotes?.forEach(n => {
      const w = n.width || 192
      const h = n.height || Math.max(80, (n.text?.length || 0) > 50 ? 148 : 100)
      map.set(n.id, { x: n.position.x, y: n.position.y, w, h })
    })
    board.checklists?.forEach(c => {
      const w = c.width || 320
      const h = c.height || Math.max(200, 80 + (c.items?.length || 0) * 48)
      map.set(c.id, { x: c.position.x, y: c.position.y, w, h })
    })
    board.kanbanBoards?.forEach(k => {
      const w = k.width || 700
      const maxTasks = Math.max(...(k.columns?.map(c => c.tasks?.length || 0) || [0]), 1)
      const h = k.height || Math.max(250, 100 + maxTasks * 64)
      map.set(k.id, { x: k.position.x, y: k.position.y, w, h })
    })
    board.textElements?.forEach(t => {
      const w = 200
      const h = Math.max(30, t.fontSize * 1.5)
      map.set(t.id, { x: t.position.x, y: t.position.y, w, h })
    })
    board.mediaItems?.forEach(m => {
      map.set(m.id, { x: m.position.x, y: m.position.y, w: m.width || 300, h: m.height || 200 })
    })
    return map
  }, [board])

  if (loading) {
    return (
      <div className="fixed inset-0 bg-zinc-900 flex items-center justify-center">
        <div className="text-center">
          <Loader2 size={32} className="animate-spin text-blue-500 mx-auto mb-3" />
          <p className="text-zinc-400 text-sm">Loading shared board...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-zinc-900 flex items-center justify-center">
        <div className="text-center">
          <Lock size={32} className="text-zinc-500 mx-auto mb-3" />
          <h2 className="text-xl font-semibold text-white mb-1">Board Unavailable</h2>
          <p className="text-zinc-400 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  if (!board) return null

  const isDark = board.themeSettings?.isDark ?? true
  const gridSettings = board.gridSettings

  return (
    <div
      className={`fixed inset-0 ${isDark ? 'bg-zinc-900' : 'bg-zinc-100'} overflow-auto`}
      style={{
        backgroundImage: board.backgroundImage ? `url(${board.backgroundImage})` : undefined,
        backgroundColor: board.backgroundColor || undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Background overlay */}
      {board.backgroundOverlay && board.backgroundImage && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            backgroundColor: board.backgroundOverlayColor || 'rgba(0,0,0,0.4)',
            backdropFilter: board.backgroundBlurLevel ? `blur(${
              board.backgroundBlurLevel === 'sm' ? '4px' :
              board.backgroundBlurLevel === 'md' ? '8px' :
              board.backgroundBlurLevel === 'lg' ? '16px' : '24px'
            })` : undefined,
          }}
        />
      )}

      {/* Top bar — board name + "View only" badge */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2">
        <div className={`flex items-center gap-3 px-5 py-2.5 rounded-xl border shadow-lg backdrop-blur-xl ${
          isDark ? 'bg-zinc-800/80 border-zinc-700/50' : 'bg-white/80 border-zinc-200/50'
        }`}>
          <div className="w-7 h-7 bg-black rounded-lg flex items-center justify-center p-1">
            <img src="/bordclear.png" alt="BORDS" className="w-full h-full object-contain" />
          </div>
          <span className={`text-base font-bold tracking-tight ${isDark ? 'text-white' : 'text-black'}`}>
            {board.name}
          </span>
          <div className="w-px h-4 bg-current opacity-20" />
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${
            isDark ? 'bg-green-500/15 text-green-400' : 'bg-green-100 text-green-700'
          }`}>
            View Only
          </span>
        </div>
      </div>

      {/* Canvas */}
      <div className="relative min-h-[370vh]">
        {/* Grid */}
        {gridSettings?.isGridVisible && (
          <ReadOnlyGrid
            gridColor={gridSettings.gridColor || (isDark ? '#333333' : '#cccccc')}
            gridSize={gridSettings.gridSize || 20}
          />
        )}

        {/* Items layer — positioned exactly like the real board */}
        <div className="relative" style={{ paddingTop: '20vh', paddingBottom: '100vh' }}>
          {/* Connections layer — inside same container so coordinate system matches items */}
          <ReadOnlyConnections connections={board.connections} items={itemRectMap} />

          {/* Drawings */}
          {board.drawings?.map(d => <ReadOnlyDrawing key={d.id} d={d} />)}

          {/* Sticky Notes */}
          {board.stickyNotes?.map(note => <ReadOnlyNote key={note.id} note={note} />)}

          {/* Checklists */}
          {board.checklists?.map(cl => <ReadOnlyChecklist key={cl.id} cl={cl} />)}

          {/* Kanban Boards */}
          {board.kanbanBoards?.map(kb => <ReadOnlyKanban key={kb.id} kb={kb} />)}

          {/* Text Elements */}
          {board.textElements?.map(t => <ReadOnlyText key={t.id} t={t} />)}

          {/* Media */}
          {board.mediaItems?.map(m => <ReadOnlyMedia key={m.id} m={m} />)}
        </div>
      </div>
    </div>
  )
}
