'use client'
import { useState } from 'react'
import { STICKY_COLORS } from '../store/stickyNoteStore'

interface StickyNoteFormProps {
  onSubmit: (data: { text: string; color: string; id: string }) => void
  onClose: () => void
  initialText?: string
  initialColor?: string
}

export function StickyNoteForm({ onSubmit, onClose, initialText = '', initialColor = 'bg-yellow-200' }: StickyNoteFormProps) {
  const [text, setText] = useState(initialText)
  const [color, setColor] = useState(initialColor)

  const handleSubmit = () => {
    const noteId = Date.now().toString()
    onSubmit({ text, color, id: noteId })
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-md z-50">
      <div className={`${color} p-6 rounded-3xl shadow-2xl w-96 border border-white/20`}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write your note..."
          className="w-full h-36 p-4 mb-5 rounded-2xl border-0 resize-none focus:outline-none focus:ring-2 focus:ring-blue-400/50 text-gray-900 placeholder:text-gray-500 bg-white/90 backdrop-blur-sm shadow-sm"
        />
        
        <div className="flex gap-3 mb-6 justify-center">
          {Object.entries(STICKY_COLORS).map(([name, colorClass]) => (
            <button
              key={name}
              onClick={() => setColor(colorClass)}
              className={`w-10 h-10 rounded-full ${colorClass} 
                ${color === colorClass ? 'ring-2 ring-offset-2 ring-blue-500 scale-110' : 'hover:scale-105'}
                transition-all duration-200 shadow-md hover:shadow-lg`}
            />
          ))}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-gray-700 hover:bg-white/60 backdrop-blur-sm rounded-xl transition-all duration-200 font-medium hover:scale-105"
          >
            Cancel
          </button>
          <button
            onClick={() => handleSubmit()}
            className="px-5 py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 transition-all duration-200 font-medium shadow-md hover:shadow-lg hover:scale-105"
          >
            Add Note
          </button>
        </div>
      </div>
    </div>
  )
}
