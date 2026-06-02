'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { useThemeStore } from '../store/themeStore'

interface DropdownOption {
  value: string
  label: string
  description?: string
  color?: string
}

interface CustomDropdownProps {
  options?: DropdownOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  showDescription?: boolean
  color?: string
  backgroundColor?: string
  textColor?: string
}

export default function CustomDropdown({ 
  options = [], 
  value, 
  onChange, 
  placeholder = "Select an option", 
  className = "",
  disabled = false,
  showDescription = false,
  color,
  backgroundColor,
  textColor
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { isDark } = useThemeStore()

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const selectedOption = options.find(option => option.value === value)

  const handleSelect = (option: DropdownOption) => {
    onChange(option.value)
    setIsOpen(false)
  }

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`w-full px-3 py-2 text-left border rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-blue-400/50 focus:border-blue-400 ${
          disabled 
            ? 'opacity-50 cursor-not-allowed'
            : 'cursor-pointer'
        } ${
          backgroundColor ? '' : isDark 
            ? 'bg-zinc-900 border-zinc-700 text-white hover:bg-zinc-800' 
            : 'bg-white border-zinc-200 text-gray-900 hover:bg-zinc-50'
        } ${backgroundColor ? backgroundColor : ''}`}
        style={backgroundColor ? { borderColor: 'rgba(255, 255, 255, 0.2)' } : {}}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-1">
            {(selectedOption?.color || color) && (
              <span className={`w-2 h-2 rounded-full ${selectedOption?.color || color}`} />
            )}
            <span className={`text-xs ${selectedOption ? (textColor || (backgroundColor ? 'text-white' : '')) : textColor || (backgroundColor ? 'text-white/70' : isDark ? 'text-gray-400' : 'text-gray-500')}`}>
              {selectedOption ? selectedOption.label : placeholder}
            </span>
          </div>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''} ${
            textColor || (backgroundColor ? 'text-white/70' : isDark ? 'text-gray-400' : 'text-gray-500')
          }`} />
        </div>
        {showDescription && selectedOption?.description && (
          <div className={`text-[10px] mt-1 ${
            textColor ? `${textColor} opacity-70` : backgroundColor ? 'text-white/70' : isDark ? 'text-gray-400' : 'text-gray-500'
          }`}>
            {selectedOption.description}
          </div>
        )}
      </button>

      {isOpen && (
        <div 
          className={`absolute z-50 w-full mt-1 border rounded-lg shadow-lg max-h-48 overflow-auto ${
            backgroundColor ? '' : isDark 
              ? 'bg-zinc-800 border-zinc-700' 
              : 'bg-white border-zinc-200'
          } ${backgroundColor ? backgroundColor : ''}`}
          style={backgroundColor ? { borderColor: 'rgba(255, 255, 255, 0.2)' } : {}}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleSelect(option)
              }}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
              }}
              className={`w-full px-3 py-2 text-left transition-colors ${
                value === option.value
                  ? backgroundColor
                    ? 'bg-white/20'
                    : isDark
                    ? 'bg-blue-900/50 text-blue-300'
                    : 'bg-blue-50 text-blue-700'
                  : backgroundColor
                    ? 'hover:bg-white/10'
                    : isDark
                    ? 'text-white hover:bg-zinc-700'
                    : 'text-gray-900 hover:bg-zinc-50'
              } ${textColor || (backgroundColor ? 'text-white' : '')}`}
            >
              <div className="flex items-center gap-2">
                {(option.color || color) && (
                  <span className={`w-2 h-2 rounded-full ${option.color || color}`} />
                )}
                <div className="font-medium text-xs">{option.label}</div>
              </div>
              {showDescription && option.description && (
                <div className={`text-[10px] mt-1 ${
                  value === option.value
                    ? textColor
                      ? `${textColor} opacity-80`
                      : backgroundColor
                      ? 'text-white/80'
                      : isDark ? 'text-blue-200' : 'text-blue-600'
                    : textColor
                      ? `${textColor} opacity-60`
                      : backgroundColor
                      ? 'text-white/60'
                      : isDark ? 'text-gray-400' : 'text-gray-500'
                }`}>
                  {option.description}
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
