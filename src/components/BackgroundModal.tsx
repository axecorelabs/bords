'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Upload, Trash2, RotateCcw, Loader2 } from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'
import { useBoardStore } from '@/store/boardStore'
import { useGridStore } from '@/store/gridStore'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const BACKGROUND_COLORS = [
  // Neutrals
  { name: 'Slate', value: '#1e293b' },
  { name: 'Gray', value: '#374151' },
  { name: 'Zinc', value: '#27272a' },
  { name: 'Stone', value: '#44403c' },
  
  // Blues
  { name: 'Sky', value: '#0369a1' },
  { name: 'Blue', value: '#1e40af' },
  { name: 'Indigo', value: '#4338ca' },
  { name: 'Navy', value: '#1e3a8a' },
  
  // Purples
  { name: 'Violet', value: '#6d28d9' },
  { name: 'Purple', value: '#7e22ce' },
  { name: 'Fuchsia', value: '#a21caf' },
  { name: 'Pink', value: '#be185d' },
  
  // Greens
  { name: 'Emerald', value: '#047857' },
  { name: 'Green', value: '#15803d' },
  { name: 'Teal', value: '#0f766e' },
  { name: 'Cyan', value: '#0e7490' },
  
  // Warm
  { name: 'Rose', value: '#be123c' },
  { name: 'Red', value: '#b91c1c' },
  { name: 'Orange', value: '#c2410c' },
  { name: 'Amber', value: '#b45309' },
  
  // More
  { name: 'Yellow', value: '#a16207' },
  { name: 'Lime', value: '#4d7c0f' },
  { name: 'Brown', value: '#78350f' },
  { name: 'Warm Gray', value: '#57534e' },
]

const OVERLAY_COLORS = [
  { name: 'Transparent', value: undefined },
  { name: 'Dark', value: 'rgba(24, 24, 27, 0.6)' },
  { name: 'Light', value: 'rgba(255, 255, 255, 0.6)' },
  { name: 'Black', value: 'rgba(0, 0, 0, 0.5)' },
  { name: 'Blue', value: 'rgba(30, 64, 175, 0.3)' },
  { name: 'Purple', value: 'rgba(126, 34, 206, 0.3)' },
  { name: 'Green', value: 'rgba(21, 128, 61, 0.3)' },
  { name: 'Red', value: 'rgba(185, 28, 28, 0.3)' },
  { name: 'Amber', value: 'rgba(180, 83, 9, 0.3)' },
]

export function BackgroundModal() {
  const isDark = useThemeStore((state) => state.isDark)
  const { isBackgroundModalOpen, closeBackgroundModal, currentBoardId, updateBoardBackground, updateBoardBackgroundColor, updateBoardOverlay, updateBoardOverlayColor, updateBoardBlurLevel } = useBoardStore()
  const setGridColor = useGridStore((state) => state.setGridColor)
  const currentBoard = useBoardStore((state) => 
    state.boards.find(board => board.id === currentBoardId)
  )
  
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string>('')
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [overlayEnabled, setOverlayEnabled] = useState(currentBoard?.backgroundOverlay ?? false)
  const [blurLevel, setBlurLevel] = useState<'sm' | 'md' | 'lg' | 'xl'>(currentBoard?.backgroundBlurLevel || 'md')
  const [activeTab, setActiveTab] = useState<'image' | 'color'>('image')
  const [customBackgroundColor, setCustomBackgroundColor] = useState(currentBoard?.backgroundColor || '#1e293b')
  const [customOverlayColor, setCustomOverlayColor] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isBackgroundModalOpen || !currentBoardId) return null

  const handleFileSelect = (file: File) => {
    setFileError('')

    // Validate file type
    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError('Please select a valid image file (JPG, PNG, GIF, or WebP)')
      return
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setFileError(`File size must be less than ${MAX_FILE_SIZE / (1024 * 1024)}MB`)
      return
    }

    setSelectedFile(file)
    
    // Create preview
    const reader = new FileReader()
    reader.onload = (e) => {
      setPreview(e.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const handleFileUpload = async () => {
    if (!selectedFile || !currentBoardId) return

    setIsUploading(true)
    setFileError('')

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('folder', 'backgrounds')

      const res = await fetch('/api/media/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Upload failed')
      }

      const { url: wasabiUrl } = await res.json()

      updateBoardBackground(currentBoardId, wasabiUrl)
      setIsUploading(false)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Failed to upload background. Please try again.')
      setIsUploading(false)
    }
  }

  const handleRemoveBackground = () => {
    updateBoardBackground(currentBoardId, undefined)
    updateBoardBackgroundColor(currentBoardId, undefined)
    handleClose()
  }

  const handleColorSelect = (color: string) => {
    if (!currentBoardId) return
    setCustomBackgroundColor(color)
    updateBoardBackgroundColor(currentBoardId, color)
    updateBoardBackground(currentBoardId, undefined) // Clear image when color is selected
  }

  const handleCustomColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentBoardId) return
    const color = e.target.value
    setCustomBackgroundColor(color)
    updateBoardBackgroundColor(currentBoardId, color)
    updateBoardBackground(currentBoardId, undefined)
  }

  const handleOverlayColorChange = (color: string | undefined) => {
    if (!currentBoardId) return
    updateBoardOverlayColor(currentBoardId, color)
  }

  const handleCustomOverlayColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!currentBoardId) return
    const color = e.target.value
    // Convert hex to rgba with 0.6 opacity
    const r = parseInt(color.slice(1, 3), 16)
    const g = parseInt(color.slice(3, 5), 16)
    const b = parseInt(color.slice(5, 7), 16)
    const rgba = `rgba(${r}, ${g}, ${b}, 0.6)`
    setCustomOverlayColor(color)
    updateBoardOverlayColor(currentBoardId, rgba)
  }

  const handleResetToDefault = () => {
    if (!currentBoardId) return
    
    // Reset background settings
    updateBoardBackground(currentBoardId, undefined)
    updateBoardBackgroundColor(currentBoardId, undefined)
    updateBoardOverlay(currentBoardId, false)
    updateBoardOverlayColor(currentBoardId, undefined)
    updateBoardBlurLevel(currentBoardId, 'md')
    
    // Reset grid to default color based on theme
    const defaultGridColor = isDark ? '#333333' : '#e5e5e5'
    setGridColor(defaultGridColor)
    
    // Reset local state
    setOverlayEnabled(false)
    setBlurLevel('md')
    setCustomBackgroundColor('#1e293b')
    setCustomOverlayColor('')
    setSelectedFile(null)
    setPreview(null)
    setFileError('')
  }

  const handleClose = () => {
    setSelectedFile(null)
    setPreview(null)
    setFileError('')
    setIsDragging(false)
    setIsUploading(false)
    closeBackgroundModal()
  }

  const handleToggleOverlay = () => {
    if (!currentBoardId) return
    const newValue = !overlayEnabled
    setOverlayEnabled(newValue)
    updateBoardOverlay(currentBoardId, newValue)
  }

  const handleBlurLevelChange = (level: 'sm' | 'md' | 'lg' | 'xl') => {
    if (!currentBoardId) return
    setBlurLevel(level)
    updateBoardBlurLevel(currentBoardId, level)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFileSelect(file)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
        onClick={handleClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className={`w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden
            ${isDark ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-zinc-200'}`}
        >
          {/* Header */}
          <div className={`px-6 py-4 border-b flex-shrink-0 ${isDark ? 'border-zinc-800' : 'border-zinc-200'}`}>
            <div className="flex items-center justify-between">
              <h2 className={`text-xl font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                Custom Background
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleResetToDefault}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors font-medium text-sm ${
                    isDark
                      ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                      : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'
                  }`}
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset to Default
                </button>
                <button
                  onClick={handleClose}
                  className={`p-2 rounded-lg transition-colors ${
                    isDark 
                      ? 'hover:bg-zinc-800 text-zinc-400 hover:text-white' 
                      : 'hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900'
                  }`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* Tabs */}
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setActiveTab('image')}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'image'
                    ? 'bg-blue-500 text-white'
                    : isDark
                    ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                Image Upload
              </button>
              <button
                onClick={() => setActiveTab('color')}
                className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors ${
                  activeTab === 'color'
                    ? 'bg-blue-500 text-white'
                    : isDark
                    ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                Solid Color
              </button>
            </div>

            {activeTab === 'image' ? (
              <>
            {/* Current Background Preview */}
            {currentBoard?.backgroundImage && !preview && (
              <div className="mb-6">
                <h3 className={`text-sm font-medium mb-3 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  Current Background
                </h3>
                <div className="relative rounded-lg overflow-hidden border-2 border-dashed border-zinc-300 dark:border-zinc-700">
                  <img 
                    src={currentBoard.backgroundImage} 
                    alt="Current background" 
                    className="w-full h-48 object-cover"
                  />
                  <button
                    onClick={handleRemoveBackground}
                    className="absolute top-2 right-2 p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors shadow-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* File Upload Area */}
            <div>
              <h3 className={`text-sm font-medium mb-3 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                {preview ? 'Preview' : 'Upload New Background'}
              </h3>
              
              {preview ? (
                <div className="space-y-4">
                  <div className="relative rounded-lg overflow-hidden border-2 border-dashed border-zinc-300 dark:border-zinc-700">
                    <img 
                      src={preview} 
                      alt="Preview" 
                      className="w-full h-64 object-cover"
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleFileUpload}
                      disabled={isUploading}
                      className="flex-1 px-4 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium flex items-center justify-center gap-2"
                    >
                      {isUploading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        'Set as Background'
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setSelectedFile(null)
                        setPreview(null)
                        setFileError('')
                      }}
                      disabled={isUploading}
                      className={`px-4 py-3 rounded-lg transition-colors font-medium ${
                        isDark 
                          ? 'bg-zinc-800 hover:bg-zinc-700 text-white' 
                          : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-900'
                      } disabled:opacity-50`}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all ${
                    isDragging
                      ? 'border-blue-500 bg-blue-500/10'
                      : isDark
                      ? 'border-zinc-700 hover:border-zinc-600 bg-zinc-800/50'
                      : 'border-zinc-300 hover:border-zinc-400 bg-zinc-50'
                  }`}
                >
                  <Upload className={`w-12 h-12 mx-auto mb-4 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`} />
                  <p className={`text-sm mb-2 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    <span className="font-medium">Click to upload</span> or drag and drop
                  </p>
                  <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                    JPG, PNG, GIF or WebP (max 10MB)
                  </p>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ALLOWED_TYPES.join(',')}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleFileSelect(file)
                    }}
                    className="hidden"
                  />
                </div>
              )}

              {fileError && (
                <p className="text-red-500 text-sm mt-2">{fileError}</p>
              )}
            </div>

            {/* Info */}
            <div className={`mt-6 p-4 rounded-lg ${isDark ? 'bg-zinc-800/50' : 'bg-zinc-100'}`}>
              <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                💡 The background image will be applied only to this board. It will appear behind all your notes, tasks, and other items.
              </p>
            </div>
              </>
            ) : (
              <>
                {/* Color Picker */}
                <div>
                  <h3 className={`text-sm font-medium mb-3 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    Select Background Color
                  </h3>
                  
                  {/* Custom Color Picker */}
                  <div className={`mb-4 p-4 rounded-lg border ${isDark ? 'bg-zinc-800/50 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                    <label className={`block text-xs font-medium mb-2 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                      Custom Color
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={customBackgroundColor}
                        onChange={handleCustomColorChange}
                        className="w-16 h-16 rounded-lg cursor-pointer border-2 border-zinc-300 dark:border-zinc-600"
                      />
                      <div className="flex-1">
                        <input
                          type="text"
                          value={customBackgroundColor}
                          onChange={(e) => {
                            setCustomBackgroundColor(e.target.value)
                            if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
                              handleColorSelect(e.target.value)
                            }
                          }}
                          placeholder="#000000"
                          className={`w-full px-3 py-2 rounded-lg border font-mono text-sm ${
                            isDark
                              ? 'bg-zinc-800 border-zinc-700 text-white'
                              : 'bg-white border-zinc-300 text-zinc-900'
                          }`}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Preset Colors */}
                  <h4 className={`text-xs font-medium mb-2 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    Quick Presets
                  </h4>
                  <div className="grid grid-cols-6 gap-3">
                    {BACKGROUND_COLORS.map((color) => (
                      <button
                        key={color.value}
                        onClick={() => handleColorSelect(color.value)}
                        className={`group relative aspect-square rounded-lg transition-all hover:scale-110 ${
                          currentBoard?.backgroundColor === color.value
                            ? 'ring-4 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900'
                            : 'hover:ring-2 hover:ring-zinc-400'
                        }`}
                        style={{ backgroundColor: color.value }}
                      >
                        <span className={`
                          absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap
                          opacity-0 group-hover:opacity-100 transition-opacity
                          ${isDark ? 'text-zinc-400' : 'text-zinc-600'}
                        `}>
                          {color.name}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Remove color button */}
                  {currentBoard?.backgroundColor && (
                    <button
                      onClick={() => {
                        if (currentBoardId) {
                          updateBoardBackgroundColor(currentBoardId, undefined)
                        }
                      }}
                      className={`mt-6 w-full px-4 py-3 rounded-lg font-medium transition-colors ${
                        isDark
                          ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                          : 'bg-red-100 text-red-600 hover:bg-red-200'
                      }`}
                    >
                      Remove Background Color
                    </button>
                  )}
                </div>

                {/* Info */}
                <div className={`mt-6 p-4 rounded-lg ${isDark ? 'bg-zinc-800/50' : 'bg-zinc-100'}`}>
                  <p className={`text-xs ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                    💡 The background color will be applied only to this board. Selecting a color will remove any uploaded image.
                  </p>
                </div>
              </>
            )}

            {/* Overlay Toggle */}
            {(currentBoard?.backgroundImage || currentBoard?.backgroundColor) && (
              <div className={`mt-4 p-4 rounded-lg border ${isDark ? 'bg-zinc-800/30 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className={`text-sm font-medium ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                      Semi-Transparent Overlay
                    </p>
                    <p className={`text-xs mt-1 ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                      Add a blur overlay to improve content visibility
                    </p>
                  </div>
                  <button
                    onClick={handleToggleOverlay}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      overlayEnabled ? 'bg-blue-500' : isDark ? 'bg-zinc-700' : 'bg-zinc-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        overlayEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Blur Level Slider */}
                {overlayEnabled && (
                  <div className="mt-4 pt-4 border-t border-zinc-700/50">
                    <p className={`text-sm font-medium mb-3 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                      Blur Intensity
                    </p>
                    <div className="flex items-center gap-2">
                      {(['sm', 'md', 'lg', 'xl'] as const).map((level) => (
                        <button
                          key={level}
                          onClick={() => handleBlurLevelChange(level)}
                          className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                            blurLevel === level
                              ? 'bg-blue-500 text-white shadow-lg'
                              : isDark
                              ? 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                              : 'bg-zinc-200 text-zinc-700 hover:bg-zinc-300'
                          }`}
                        >
                          {level.toUpperCase()}
                        </button>
                      ))}
                    </div>

                    {/* Overlay Color Picker */}
                    <div className="mt-4">
                      <p className={`text-sm font-medium mb-3 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                        Overlay Color
                      </p>
                      
                      {/* Custom Overlay Color */}
                      <div className={`mb-3 p-3 rounded-lg border ${isDark ? 'bg-zinc-800/50 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                        <label className={`block text-xs font-medium mb-2 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                          Custom Overlay (60% opacity)
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="color"
                            value={customOverlayColor || '#000000'}
                            onChange={handleCustomOverlayColorChange}
                            className="w-12 h-12 rounded-lg cursor-pointer border-2 border-zinc-300 dark:border-zinc-600"
                          />
                          <span className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-500'}`}>
                            Pick any color for overlay
                          </span>
                        </div>
                      </div>

                      {/* Preset Overlay Colors */}
                      <h4 className={`text-xs font-medium mb-2 ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                        Quick Presets
                      </h4>
                      <div className="grid grid-cols-5 gap-2">
                        {OVERLAY_COLORS.map((color) => (
                          <button
                            key={color.name}
                            onClick={() => handleOverlayColorChange(color.value)}
                            className={`group relative aspect-square rounded-lg transition-all hover:scale-110 border-2 ${
                              currentBoard?.backgroundOverlayColor === color.value || (!currentBoard?.backgroundOverlayColor && !color.value)
                                ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-white dark:ring-offset-zinc-900'
                                : 'border-zinc-300 dark:border-zinc-700'
                            }`}
                            style={{ 
                              backgroundColor: color.value || 'transparent',
                              backgroundImage: !color.value ? 'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)' : undefined,
                              backgroundSize: !color.value ? '20px 20px' : undefined,
                              backgroundPosition: !color.value ? '0 0, 0 10px, 10px -10px, -10px 0px' : undefined
                            }}
                          >
                            <span className={`
                              absolute -bottom-6 left-1/2 -translate-x-1/2 text-[10px] whitespace-nowrap
                              opacity-0 group-hover:opacity-100 transition-opacity
                              ${isDark ? 'text-zinc-400' : 'text-zinc-600'}
                            `}>
                              {color.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
