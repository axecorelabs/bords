'use client'
import { createPortal } from 'react-dom'
import { Trash2, X } from 'lucide-react'
import { useThemeStore } from '../store/themeStore'

interface DeleteConfirmModalProps {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  itemName?: string
  itemType?: string
}

export function DeleteConfirmModal({ isOpen, onConfirm, onCancel, itemName, itemType = 'item' }: DeleteConfirmModalProps) {
  const isDark = useThemeStore((state) => state.isDark)

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999]"
      style={{ touchAction: 'auto' }}
      onClick={onCancel}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <div
        className={`p-5 rounded-2xl shadow-2xl max-w-sm w-full mx-4 ${
          isDark ? 'bg-zinc-800 border border-zinc-700' : 'bg-white'
        }`}
        style={{ touchAction: 'auto' }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2.5 rounded-full bg-red-100 shrink-0">
            <Trash2 size={20} className="text-red-600" />
          </div>
          <div className="flex-1">
            <h3 className={`text-base font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
              Delete {itemType}?
            </h3>
            <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              {itemName ? (
                <>Are you sure you want to delete <span className="font-semibold">&quot;{itemName}&quot;</span>? This can&apos;t be undone.</>
              ) : (
                <>Are you sure? This action can&apos;t be undone.</>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            onPointerDown={(e) => e.stopPropagation()}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              isDark
                ? 'bg-zinc-700 hover:bg-zinc-600 text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
