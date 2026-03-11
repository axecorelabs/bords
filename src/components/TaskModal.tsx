'use client'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { XCircle, Calendar, Clock, FileText, AlertCircle } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { useThemeStore } from '@/store/themeStore'

interface TaskModalProps {
  onClose: () => void
  onSubmit: (data: { text: string; date: string; time: string }) => void
  initialData?: {
    text: string
    date?: string
    time?: string
  }
  title: string
}

export function TaskModal({ onClose, onSubmit, initialData, title }: TaskModalProps) {
  const isDark = useThemeStore((s) => s.isDark)
  const [text, setText] = useState(initialData?.text || '')
  const [date, setDate] = useState(initialData?.date || '')
  const [time, setTime] = useState(initialData?.time || '')

  const validateDateTime = (date: string, time: string) => {
    if ((date && !time) || (!date && time)) {
      return false;
    }
    if (!date || !time) return true;

    const dateTime = new Date(`${date}T${time}`);
    return dateTime > new Date();
  }

  const getMinTime = (date: string) => {
    if (date === new Date().toISOString().split('T')[0]) {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    return '00:00';
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      toast.error('Task description is required');
      return;
    }
    
    if (!validateDateTime(date, time)) {
      toast.error('Please provide both date and time, and ensure they are in the future');
      return;
    }

    onSubmit({ text, date, time });
    onClose();
  }

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm z-[9999]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
    >
      <form
        onSubmit={handleSubmit}
        className={`rounded-2xl shadow-2xl w-[440px] max-w-[95vw] overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${
          isDark ? 'bg-zinc-800 border border-zinc-700' : 'bg-white'
        }`}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 pt-5 pb-3">
          <h2 className={`text-lg font-bold ${isDark ? 'text-zinc-100' : 'text-gray-900'}`}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            className={`p-1.5 rounded-lg transition-all ${
              isDark ? 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700' : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            }`}
          >
            <XCircle size={20} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          {/* Task Description */}
          <div>
            <label className={`flex items-center gap-1.5 text-sm font-semibold mb-2 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
              <FileText size={14} className="text-blue-500" />
              Task Description
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className={`w-full px-3.5 py-2.5 border rounded-xl min-h-[100px] text-sm
                         placeholder:text-opacity-50 resize-none
                         focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400
                         transition-all duration-150 ${
                isDark
                  ? 'bg-zinc-900 border-zinc-600 text-zinc-200 placeholder:text-zinc-500'
                  : 'bg-white border-gray-200 text-gray-800 placeholder:text-gray-400'
              }`}
              placeholder="What needs to be done?"
              autoFocus
            />
          </div>

          {/* Deadline Section */}
          <div>
            <label className={`flex items-center gap-1.5 text-sm font-semibold mb-2 ${isDark ? 'text-zinc-300' : 'text-gray-700'}`}>
              <Clock size={14} className="text-amber-500" />
              Deadline
              <span className={`text-xs font-normal ml-1 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>(optional)</span>
            </label>
            <div className="flex gap-3">
              <div className="flex-1">
                <div className="relative">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setTime('');
                    }}
                    min={new Date().toISOString().split('T')[0]}
                    className={`w-full px-3.5 py-2.5 border rounded-xl text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400
                               transition-all duration-150 pr-9 ${
                      isDark
                        ? 'bg-zinc-900 border-zinc-600 text-zinc-200'
                        : 'bg-white border-gray-200 text-gray-800'
                    }`}
                  />
                  <Calendar className={`absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none ${isDark ? 'text-zinc-500' : 'text-gray-400'}`} />
                </div>
              </div>
              <div className="w-[130px]">
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  min={date ? getMinTime(date) : undefined}
                  className={`w-full px-3.5 py-2.5 border rounded-xl text-sm
                             focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400
                             transition-all duration-150
                             ${!date
                               ? isDark
                                 ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed border-zinc-700'
                                 : 'bg-gray-50 text-gray-400 cursor-not-allowed border-gray-200'
                               : isDark
                                 ? 'bg-zinc-900 text-zinc-200 border-zinc-600'
                                 : 'bg-white text-gray-800 border-gray-200'
                             }`}
                  disabled={!date}
                />
              </div>
            </div>
            {!date && (
              <p className={`flex items-center gap-1 text-xs mt-1.5 ml-0.5 ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>
                <AlertCircle size={11} />
                Set a date first to enable time selection
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              onPointerDown={(e) => e.stopPropagation()}
              className={`px-4 py-2 text-sm font-medium rounded-xl transition-all duration-150 ${
                isDark
                  ? 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              onPointerDown={(e) => e.stopPropagation()}
              className={`px-5 py-2 text-sm font-semibold rounded-xl transition-all duration-150 shadow-sm
                         ${text.trim()
                           ? 'bg-blue-500 text-white hover:bg-blue-600 hover:shadow-md active:scale-[0.98]'
                           : isDark
                             ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                             : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
              disabled={!text.trim()}
            >
              {initialData ? 'Update Task' : 'Add Task'}
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body
  )
}
