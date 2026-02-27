'use client'

import dynamic from 'next/dynamic'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useThemeStore } from '@/store/themeStore'
import { useNoteStore } from '@/store/stickyNoteStore'
import { ArrowLeft, Plus, Loader2, Sun, Moon } from 'lucide-react'

// Dynamic import — tldraw must only run client-side (no SSR)
const TldrawCanvas = dynamic(
  () => import('@/tldraw/TldrawCanvas').then((m) => m.TldrawCanvas),
  { ssr: false, loading: () => <LoadingSpinner /> }
)

function LoadingSpinner() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-zinc-100 dark:bg-zinc-900">
      <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
    </div>
  )
}

export default function CanvasPocPage() {
  const { status } = useSession()
  const router = useRouter()
  const isDark = useThemeStore((s) => s.isDark)
  const toggleDarkMode = useThemeStore((s) => s.toggleDark)
  const addNote = useNoteStore((s) => s.addNote)
  const notes = useNoteStore((s) => s.notes)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login')
  }, [status, router])

  if (!mounted || status === 'loading') return <LoadingSpinner />

  const handleAddStickyNote = () => {
    const id = crypto.randomUUID()
    addNote({
      id,
      text: 'Hello from tldraw! ✨\nDouble-click to edit.',
      color: 'bg-yellow-200',
      position: {
        x: 200 + Math.random() * 400,
        y: 200 + Math.random() * 300,
      },
      width: 220,
      height: 160,
    })
    // Force re-mount the canvas to pick up the new note
    // In production, this would be a proper tldraw editor.createShape call
    window.location.reload()
  }

  return (
    <div className={`${isDark ? 'dark' : ''}`}>
      {/* tldraw canvas — fills the screen */}
      <TldrawCanvas />

      {/* Floating POC toolbar */}
      <div
        style={{
          position: 'fixed',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          borderRadius: 16,
          background: isDark ? 'rgba(24,24,27,0.9)' : 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(12px)',
          border: `1px solid ${isDark ? 'rgba(63,63,70,0.5)' : 'rgba(228,228,231,0.5)'}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <button
          onClick={() => router.push('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 10,
            border: 'none',
            background: isDark ? '#27272a' : '#f4f4f5',
            color: isDark ? '#d4d4d8' : '#3f3f46',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <div
          style={{
            width: 1,
            height: 24,
            background: isDark ? '#3f3f46' : '#e4e4e7',
          }}
        />

        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: isDark ? '#a1a1aa' : '#71717a',
            letterSpacing: 0.5,
          }}
        >
          TLDRAW POC
        </span>

        <div
          style={{
            width: 1,
            height: 24,
            background: isDark ? '#3f3f46' : '#e4e4e7',
          }}
        />

        <span
          style={{
            fontSize: 12,
            color: isDark ? '#71717a' : '#a1a1aa',
          }}
        >
          {notes.length} note{notes.length !== 1 ? 's' : ''}
        </span>

        <button
          onClick={handleAddStickyNote}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '6px 12px',
            borderRadius: 10,
            border: 'none',
            background: '#3b82f6',
            color: 'white',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <Plus size={14} />
          Add Note
        </button>

        <button
          onClick={toggleDarkMode}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: 6,
            borderRadius: 10,
            border: 'none',
            background: isDark ? '#27272a' : '#f4f4f5',
            color: isDark ? '#d4d4d8' : '#3f3f46',
            cursor: 'pointer',
          }}
          title="Toggle dark mode"
        >
          {isDark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>

      {/* Info banner */}
      <div
        style={{
          position: 'fixed',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          padding: '10px 20px',
          borderRadius: 12,
          background: isDark ? 'rgba(24,24,27,0.9)' : 'rgba(255,255,255,0.9)',
          backdropFilter: 'blur(12px)',
          border: `1px solid ${isDark ? 'rgba(63,63,70,0.5)' : 'rgba(228,228,231,0.5)'}`,
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          fontSize: 12,
          color: isDark ? '#a1a1aa' : '#71717a',
          maxWidth: 500,
          textAlign: 'center' as const,
        }}
      >
        <strong>POC:</strong> Pan with scroll/trackpad. Zoom with pinch/ctrl+scroll.
        Click to select, drag to move, resize from edges. Multi-select with shift+click or box-select.
        Undo with ⌘Z.
      </div>
    </div>
  )
}
