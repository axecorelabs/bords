'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'

interface StickyNoteEditModalProps {
  initialText: string
  onClose: () => void
  onSave: (text: string) => void
  color?: string
}

export function StickyNoteEditModal({ initialText, onClose, onSave, color = 'bg-yellow-200' }: StickyNoteEditModalProps) {
  const isDark = useThemeStore((s) => s.isDark)
  const [text, setText] = useState(initialText)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autoResize = useCallback(() => {
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.max(160, Math.min(ta.scrollHeight, 400))}px`
    }
  }, [])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.select()
      autoResize()
    }
  }, [autoResize])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(text)
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      if (text.trim()) {
        onSave(text)
        onClose()
      }
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/40 backdrop-blur-md z-[9999] flex items-center justify-center" onKeyDown={handleKeyDown} onPointerDown={(e) => e.stopPropagation()}>
      <motion.form
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        onSubmit={handleSubmit}
        onPointerDown={(e: React.PointerEvent) => e.stopPropagation()}
        className={`${color} p-6 rounded-3xl shadow-2xl w-[420px] border border-white/20`}
      >
        <div className="flex justify-between items-center mb-6">
          <h2 className={`text-xl font-semibold ${isDark ? 'text-zinc-100' : 'text-gray-800'}`}>Edit Note</h2>
          <button
            type="button"
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            className={`backdrop-blur-sm rounded-full p-2 transition-all duration-200 hover:scale-110 ${
              isDark ? 'text-zinc-400 hover:text-zinc-200 hover:bg-white/20' : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
            }`}
          >
            <X size={20} />
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            autoResize()
          }}
          className={`w-full min-h-[160px] max-h-[400px] p-4 border-0 rounded-2xl resize-none focus:ring-2 focus:ring-blue-400/50 focus:outline-none backdrop-blur-sm shadow-sm ${
            isDark ? 'bg-black/20 text-zinc-100 placeholder:text-zinc-400' : 'bg-white/90 text-gray-900 placeholder:text-gray-500'
          }`}
          placeholder="Enter note text..."
          autoFocus
        />

        <div className="flex justify-between items-center mt-6">
          <span className={`text-xs ${isDark ? 'text-zinc-400/70' : 'text-gray-500/70'}`}>
            {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter to save · Esc to cancel
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              className={`px-5 py-2.5 backdrop-blur-sm rounded-xl transition-all duration-200 font-medium hover:scale-105 ${
                isDark ? 'text-zinc-300 hover:bg-white/20' : 'text-gray-700 hover:bg-white/60'
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              onPointerDown={(e) => e.stopPropagation()}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              disabled={!text.trim()}
            >
              Save Changes
            </button>
          </div>
        </div>
      </motion.form>
    </div>,
    document.body
  )
}
