'use client'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useThemeStore } from '@/store/themeStore'

export const boardColorOptions = [
  // Row 1 — warm (light)
  { name: 'Yellow', value: 'bg-yellow-200/80' },
  { name: 'Amber', value: 'bg-amber-200/80' },
  { name: 'Orange', value: 'bg-orange-200/80' },
  { name: 'Red', value: 'bg-red-200/80' },
  { name: 'Rose', value: 'bg-rose-200/80' },
  // Row 2 — cool (light)
  { name: 'Pink', value: 'bg-pink-200/80' },
  { name: 'Fuchsia', value: 'bg-fuchsia-200/80' },
  { name: 'Purple', value: 'bg-purple-200/80' },
  { name: 'Violet', value: 'bg-violet-200/80' },
  { name: 'Indigo', value: 'bg-indigo-200/80' },
  // Row 3 — nature (light)
  { name: 'Blue', value: 'bg-blue-200/80' },
  { name: 'Sky', value: 'bg-sky-200/80' },
  { name: 'Cyan', value: 'bg-cyan-200/80' },
  { name: 'Teal', value: 'bg-teal-200/80' },
  { name: 'Emerald', value: 'bg-emerald-200/80' },
  // Row 4 — earth + neutral (light)
  { name: 'Green', value: 'bg-green-200/80' },
  { name: 'Lime', value: 'bg-lime-200/80' },
  { name: 'Stone', value: 'bg-stone-200/80' },
  { name: 'Zinc', value: 'bg-zinc-200/80' },
  { name: 'White', value: 'bg-white/90' },
  // Row 5 — warm (dark)
  { name: 'Dark Yellow', value: 'bg-yellow-800/80' },
  { name: 'Dark Amber', value: 'bg-amber-800/80' },
  { name: 'Dark Orange', value: 'bg-orange-800/80' },
  { name: 'Dark Red', value: 'bg-red-800/80' },
  { name: 'Dark Rose', value: 'bg-rose-800/80' },
  // Row 6 — cool (dark)
  { name: 'Dark Pink', value: 'bg-pink-800/80' },
  { name: 'Dark Fuchsia', value: 'bg-fuchsia-800/80' },
  { name: 'Dark Purple', value: 'bg-purple-800/80' },
  { name: 'Dark Violet', value: 'bg-violet-800/80' },
  { name: 'Dark Indigo', value: 'bg-indigo-800/80' },
  // Row 7 — nature (dark)
  { name: 'Dark Blue', value: 'bg-blue-800/80' },
  { name: 'Dark Sky', value: 'bg-sky-800/80' },
  { name: 'Dark Cyan', value: 'bg-cyan-800/80' },
  { name: 'Dark Teal', value: 'bg-teal-800/80' },
  { name: 'Dark Emerald', value: 'bg-emerald-800/80' },
  // Row 8 — earth + neutral (dark)
  { name: 'Dark Green', value: 'bg-green-800/80' },
  { name: 'Dark Lime', value: 'bg-lime-800/80' },
  { name: 'Dark Stone', value: 'bg-stone-700/80' },
  { name: 'Dark Zinc', value: 'bg-zinc-700/80' },
  { name: 'Dark', value: 'bg-zinc-900/90' },
]

/** Hex color options for components that use inline style backgroundColor */
export const hexColorOptions = [
  // Row 1 — warm (light)
  { name: 'Yellow', value: '#FEF3C7' },
  { name: 'Amber', value: '#FDE68A' },
  { name: 'Orange', value: '#FFEDD5' },
  { name: 'Red', value: '#FEE2E2' },
  { name: 'Rose', value: '#FFE4E6' },
  // Row 2 — cool (light)
  { name: 'Pink', value: '#FCE7F3' },
  { name: 'Fuchsia', value: '#FAE8FF' },
  { name: 'Purple', value: '#E9D5FF' },
  { name: 'Violet', value: '#DDD6FE' },
  { name: 'Indigo', value: '#C7D2FE' },
  // Row 3 — nature (light)
  { name: 'Blue', value: '#DBEAFE' },
  { name: 'Sky', value: '#BAE6FD' },
  { name: 'Cyan', value: '#CFFAFE' },
  { name: 'Teal', value: '#CCFBF1' },
  { name: 'Emerald', value: '#D1FAE5' },
  // Row 4 — earth + neutral (light)
  { name: 'Green', value: '#DCFCE7' },
  { name: 'Lime', value: '#ECFCCB' },
  { name: 'Stone', value: '#E7E5E4' },
  { name: 'Gray', value: '#F3F4F6' },
  { name: 'White', value: '#FFFFFF' },
  // Row 5 — warm (dark)
  { name: 'Dark Yellow', value: '#854D0E' },
  { name: 'Dark Amber', value: '#92400E' },
  { name: 'Dark Orange', value: '#9A3412' },
  { name: 'Dark Red', value: '#991B1B' },
  { name: 'Dark Rose', value: '#9F1239' },
  // Row 6 — cool (dark)
  { name: 'Dark Pink', value: '#9D174D' },
  { name: 'Dark Fuchsia', value: '#86198F' },
  { name: 'Dark Purple', value: '#6B21A8' },
  { name: 'Dark Violet', value: '#5B21B6' },
  { name: 'Dark Indigo', value: '#3730A3' },
  // Row 7 — nature (dark)
  { name: 'Dark Blue', value: '#1E40AF' },
  { name: 'Dark Sky', value: '#075985' },
  { name: 'Dark Cyan', value: '#155E75' },
  { name: 'Dark Teal', value: '#115E59' },
  { name: 'Dark Emerald', value: '#065F46' },
  // Row 8 — earth + neutral (dark)
  { name: 'Dark Green', value: '#166534' },
  { name: 'Dark Lime', value: '#3F6212' },
  { name: 'Dark Stone', value: '#44403C' },
  { name: 'Dark Gray', value: '#374151' },
  { name: 'Black', value: '#18181B' },
]

interface ColorOption {
  name: string
  value: string
}

interface ColorPickerProps {
  currentColor: string
  onSelect: (color: string) => void
  onClose: () => void
  /** Label shown at top, e.g. "Select Color" */
  label?: string
  /** Position classes, e.g. "top-full right-0 mt-2" */
  position?: string
  /** Use hex color options (inline style) instead of Tailwind class options */
  useHex?: boolean
  /** Override with fully custom color options */
  colors?: ColorOption[]
  /** Ref to the trigger button — enables portal mode so the picker escapes overflow/stacking contexts */
  triggerRef?: React.RefObject<HTMLElement | null>
}

export function ColorPicker({
  currentColor,
  onSelect,
  onClose,
  label = 'Select Color',
  position = 'top-full right-0 mt-2',
  useHex = false,
  colors,
  triggerRef,
}: ColorPickerProps) {
  const isDark = useThemeStore((s) => s.isDark)
  const ref = useRef<HTMLDivElement>(null)
  const options = colors ?? (useHex ? hexColorOptions : boardColorOptions)
  const [fixedPos, setFixedPos] = useState<{ top: number; right: number } | null>(null)
  const usePortal = !!triggerRef

  // Compute fixed position from trigger button
  useEffect(() => {
    if (!usePortal || !triggerRef?.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setFixedPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right })
  }, [usePortal, triggerRef])

  // Click-outside to close
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          (!triggerRef?.current || !triggerRef.current.contains(e.target as Node))) {
        onClose()
      }
    }
    const timer = setTimeout(() => document.addEventListener('mousedown', handle), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handle)
    }
  }, [onClose, triggerRef])

  const pickerContent = (
    <div
      ref={ref}
      className={
        usePortal
          ? `fixed backdrop-blur-md rounded-2xl shadow-xl border p-3 z-[99999] ${isDark ? 'bg-zinc-800/95 border-zinc-700' : 'bg-white/95 border-black/10'}`
          : `absolute ${position} backdrop-blur-md rounded-2xl shadow-xl border p-3 z-[9999] ${isDark ? 'bg-zinc-800/95 border-zinc-700' : 'bg-white/95 border-black/10'}`
      }
      style={usePortal && fixedPos ? { top: fixedPos.top, right: fixedPos.right } : undefined}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <div className={`text-xs font-medium mb-2 text-center ${isDark ? 'text-zinc-400' : 'text-gray-600'}`}>
        {label}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={(e) => {
              e.stopPropagation()
              onSelect(opt.value)
              onClose()
            }}
            className={`w-8 h-8 rounded-lg border-2 transition-all duration-150 hover:scale-110 ${
              currentColor === opt.value
                ? `border-blue-500 scale-110 ring-2 ${isDark ? 'ring-blue-500/30' : 'ring-blue-200'}`
                : isDark ? 'border-zinc-600 hover:border-zinc-500' : 'border-gray-200 hover:border-gray-300'
            } ${useHex || colors ? '' : opt.value}`}
            style={useHex || colors ? { backgroundColor: opt.value } : undefined}
            title={opt.name}
          />
        ))}
      </div>
    </div>
  )

  if (usePortal && fixedPos) {
    return createPortal(pickerContent, document.body)
  }

  return pickerContent
}
