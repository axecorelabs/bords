'use client'
import { useState } from 'react'
import { X, Link, Upload, Image as ImageIcon, Video } from 'lucide-react'
import { useMediaStore, MediaType } from '../store/mediaStore'
import { useThemeStore } from '../store/themeStore'
import { useBoardStore } from '../store/boardStore'
import { useZIndexStore } from '../store/zIndexStore'
import { useViewportScale } from '../hooks/useViewportScale'

type SelectionMode = 'type-selection' | 'url-form' | 'upload-form'

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_VIDEO_SIZE = 50 * 1024 * 1024 // 50MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime']

export function MediaModal() {
  const { isMediaModalOpen, closeMediaModal, addMedia } = useMediaStore()
  const isDark = useThemeStore((state) => state.isDark)
  const currentBoardId = useBoardStore((state) => state.currentBoardId)
  const addMediaToBoard = useBoardStore((state) => state.addMediaToBoard)
  const vScale = useViewportScale()
  
  const [mode, setMode] = useState<SelectionMode>('type-selection')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [mediaType, setMediaType] = useState<MediaType>('image')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string>('')
  const [isProcessing, setIsProcessing] = useState(false)

  // Auto-detect video URLs when user types/pastes
  const isVideoUrl = (u: string): boolean => {
    const trimmed = u.trim().toLowerCase()
    return /youtu\.?be|youtube\.com|vimeo\.com|dailymotion\.com|twitch\.tv|tiktok\.com/.test(trimmed)
      || /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/.test(trimmed)
  }

  const handleUrlChange = (value: string) => {
    setUrl(value)
    if (isVideoUrl(value)) setMediaType('video')
    else if (mediaType === 'video' && !isVideoUrl(value)) setMediaType('image')
  }

  if (!isMediaModalOpen) return null

  const handleClose = () => {
    closeMediaModal()
    // Reset form
    setTimeout(() => {
      setMode('type-selection')
      setUrl('')
      setTitle('')
      setDescription('')
      setMediaType('image')
      setSelectedFile(null)
      setFileError('')
      setIsProcessing(false)
    }, 300)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!url.trim()) return

    // Position at viewport center with random offset to prevent stacking
    const offsetX = (Math.random() - 0.5) * 120
    const offsetY = (Math.random() - 0.5) * 120
    const newMedia = {
      url: url.trim(),
      title: title.trim() || undefined,
      description: description.trim() || undefined,
      type: mediaType,
      position: {
        x: Math.max(50, Math.min(window.innerWidth - 300, window.innerWidth / 2 - 125 + offsetX)) / vScale,
        y: Math.max(50, Math.min(window.innerHeight - 400, window.innerHeight / 2 - 188 + offsetY)) / vScale,
      },
      width: mediaType === 'image' ? 250 : 210,
      height: mediaType === 'image' ? 375 : 118,
    }

    addMedia(newMedia)
    
    // Add to current board and bring to front
    if (currentBoardId) {
      // Get the newly created media ID (it will be the last one)
      setTimeout(() => {
        const medias = useMediaStore.getState().medias
        const latestMedia = medias[medias.length - 1]
        if (latestMedia) {
          addMediaToBoard(currentBoardId, latestMedia.id)
          useZIndexStore.getState().bringToFront(latestMedia.id)
        }
      }, 0)
    }
    
    handleClose()
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileError('')

    // Validate file type
    const isImage = ALLOWED_IMAGE_TYPES.includes(file.type)
    const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type)

    if (!isImage && !isVideo) {
      setFileError('Invalid file type. Please upload an image (JPG, PNG, GIF, WebP) or video (MP4, WebM, MOV).')
      return
    }

    // Validate file size
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE
    if (file.size > maxSize) {
      const maxSizeMB = maxSize / (1024 * 1024)
      setFileError(`File size exceeds ${maxSizeMB}MB limit for ${isVideo ? 'videos' : 'images'}.`)
      return
    }

    // Set media type based on file
    setMediaType(isVideo ? 'video' : 'image')
    setSelectedFile(file)
  }

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!selectedFile) return

    setIsProcessing(true)
    
    try {
      // Upload file to Wasabi via API route
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('folder', 'media')

      const res = await fetch('/api/media/upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Upload failed')
      }

      const { url: wasabiUrl } = await res.json()

      // Position at viewport center with random offset to prevent stacking
      const offsetX = (Math.random() - 0.5) * 120
      const offsetY = (Math.random() - 0.5) * 120
      const newMedia = {
        url: wasabiUrl,
        title: title.trim() || selectedFile.name,
        description: description.trim() || undefined,
        type: mediaType,
        position: {
          x: Math.max(50, Math.min(window.innerWidth - 300, window.innerWidth / 2 - 125 + offsetX)) / vScale,
          y: Math.max(50, Math.min(window.innerHeight - 400, window.innerHeight / 2 - 188 + offsetY)) / vScale,
        },
        width: mediaType === 'image' ? 250 : 210,
        height: mediaType === 'image' ? 375 : 118,
      }

      addMedia(newMedia)
      
      // Add to current board and bring to front
      if (currentBoardId) {
        setTimeout(() => {
          const medias = useMediaStore.getState().medias
          const latestMedia = medias[medias.length - 1]
          if (latestMedia) {
            addMediaToBoard(currentBoardId, latestMedia.id)
            useZIndexStore.getState().bringToFront(latestMedia.id)
          }
        }, 0)
      }
      
      setIsProcessing(false)
      handleClose()
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Failed to upload file. Please try again.')
      setIsProcessing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className={`relative w-full max-w-lg max-h-[95vh] rounded-2xl shadow-2xl border flex flex-col
        ${isDark 
          ? 'bg-zinc-900 border-zinc-700' 
          : 'bg-white border-zinc-200'}`}>
        
        {/* Header */}
        <div className={`flex items-center justify-between p-6 border-b shrink-0
          ${isDark ? 'border-zinc-700' : 'border-zinc-200'}`}>
          <h2 className={`text-xl font-semibold
            ${isDark ? 'text-white' : 'text-zinc-900'}`}>
            Add Media
          </h2>
          <button
            onClick={handleClose}
            className={`p-2 rounded-lg transition-colors
              ${isDark 
                ? 'hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200' 
                : 'hover:bg-zinc-100 text-zinc-600 hover:text-zinc-900'}`}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1">
          {mode === 'type-selection' && (
            <div className="space-y-3">
              <p className={`text-sm mb-4
                ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                Choose how you want to add media to your board
              </p>
              
              <button
                onClick={() => setMode('url-form')}
                className={`w-full p-4 rounded-xl border-2 transition-all
                  ${isDark 
                    ? 'border-zinc-700 hover:border-blue-500 bg-zinc-800/50 hover:bg-zinc-800' 
                    : 'border-zinc-200 hover:border-blue-500 bg-zinc-50 hover:bg-zinc-100'}
                  group`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-lg
                    ${isDark ? 'bg-blue-500/20' : 'bg-blue-500/10'}`}>
                    <Link className="w-6 h-6 text-blue-500" />
                  </div>
                  <div className="flex-1 text-left">
                    <h3 className={`font-semibold mb-1
                      ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                      URL Link
                    </h3>
                    <p className={`text-sm
                      ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                      Add an image or video from a URL
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => setMode('upload-form')}
                className={`w-full p-4 rounded-xl border-2 transition-all
                  ${isDark 
                    ? 'border-zinc-700 hover:border-blue-500 bg-zinc-800/50 hover:bg-zinc-800' 
                    : 'border-zinc-200 hover:border-blue-500 bg-zinc-50 hover:bg-zinc-100'}
                  group`}
              >
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-lg
                    ${isDark ? 'bg-purple-500/20' : 'bg-purple-500/10'}`}>
                    <Upload className="w-6 h-6 text-purple-500" />
                  </div>
                  <div className="flex-1 text-left">
                    <h3 className={`font-semibold mb-1
                      ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                      Upload File
                    </h3>
                    <p className={`text-sm
                      ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                      Upload images or videos from your device
                    </p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {mode === 'url-form' && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Media Type Selection */}
              <div>
                <label className={`block text-sm font-medium mb-2
                  ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  Media Type *
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setMediaType('image')}
                    className={`p-3 rounded-lg border-2 transition-all
                      ${mediaType === 'image'
                        ? isDark
                          ? 'border-blue-500 bg-blue-500/20'
                          : 'border-blue-500 bg-blue-500/10'
                        : isDark
                          ? 'border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800'
                          : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100'}`}
                  >
                    <ImageIcon className={`w-5 h-5 mx-auto mb-1 ${mediaType === 'image' ? 'text-blue-500' : isDark ? 'text-zinc-400' : 'text-zinc-600'}`} />
                    <span className={`text-sm font-medium ${mediaType === 'image' ? 'text-blue-500' : isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                      Image
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMediaType('video')}
                    className={`p-3 rounded-lg border-2 transition-all
                      ${mediaType === 'video'
                        ? isDark
                          ? 'border-blue-500 bg-blue-500/20'
                          : 'border-blue-500 bg-blue-500/10'
                        : isDark
                          ? 'border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800'
                          : 'border-zinc-200 bg-zinc-50 hover:bg-zinc-100'}`}
                  >
                    <Video className={`w-5 h-5 mx-auto mb-1 ${mediaType === 'video' ? 'text-blue-500' : isDark ? 'text-zinc-400' : 'text-zinc-600'}`} />
                    <span className={`text-sm font-medium ${mediaType === 'video' ? 'text-blue-500' : isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                      Video
                    </span>
                  </button>
                </div>
              </div>

              {/* URL Input */}
              <div>
                <label className={`block text-sm font-medium mb-2
                  ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  URL *
                </label>
                <input
                  type="url"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder={mediaType === 'image' ? 'https://example.com/image.jpg' : 'https://youtube.com/watch?v=...'}
                  required
                  className={`w-full px-4 py-2 rounded-lg border transition-colors
                    ${isDark 
                      ? 'bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500 focus:border-blue-500' 
                      : 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-blue-500'}
                    outline-none`}
                />
                <p className={`mt-2 text-xs flex items-start gap-1
                  ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
                  <span>⚠️</span>
                  <span>Note: Not all external URLs may work due to security restrictions. For best results, use file upload or CORS-friendly sources.</span>
                </p>
              </div>

              {/* Title Input */}
              <div>
                <label className={`block text-sm font-medium mb-2
                  ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  Title (Optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Give your media a title"
                  className={`w-full px-4 py-2 rounded-lg border transition-colors
                    ${isDark 
                      ? 'bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500 focus:border-blue-500' 
                      : 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-blue-500'}
                    outline-none`}
                />
              </div>

              {/* Description Input */}
              <div>
                <label className={`block text-sm font-medium mb-2
                  ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  Description (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add a description"
                  rows={3}
                  className={`w-full px-4 py-2 rounded-lg border transition-colors resize-none
                    ${isDark 
                      ? 'bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500 focus:border-blue-500' 
                      : 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-blue-500'}
                    outline-none`}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setMode('type-selection')}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors
                    ${isDark 
                      ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' 
                      : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'}`}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 rounded-lg font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                >
                  Add Media
                </button>
              </div>
            </form>
          )}

          {mode === 'upload-form' && (
            <form onSubmit={handleFileUpload} className="space-y-4">
              {/* File Upload */}
              <div>
                <label className={`block text-sm font-medium mb-2
                  ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  Select File *
                </label>
                <div className={`relative border-2 border-dashed rounded-xl p-6 transition-colors
                  ${selectedFile
                    ? isDark ? 'border-green-500 bg-green-500/10' : 'border-green-500 bg-green-500/5'
                    : isDark ? 'border-zinc-700 hover:border-zinc-600' : 'border-zinc-300 hover:border-zinc-400'}`}>
                  <input
                    type="file"
                    accept={`${ALLOWED_IMAGE_TYPES.join(',')},${ALLOWED_VIDEO_TYPES.join(',')}`}
                    onChange={handleFileSelect}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="text-center pointer-events-none">
                    {selectedFile ? (
                      <>
                        <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg mb-3
                          ${isDark ? 'bg-green-500/20' : 'bg-green-500/10'}`}>
                          {mediaType === 'video' ? (
                            <Video className="w-6 h-6 text-green-500" />
                          ) : (
                            <ImageIcon className="w-6 h-6 text-green-500" />
                          )}
                        </div>
                        <p className={`font-medium mb-1
                          ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                          {selectedFile.name}
                        </p>
                        <p className={`text-sm
                          ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                          {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                        </p>
                        <p className={`text-xs mt-2 text-green-500`}>
                          Click to change file
                        </p>
                      </>
                    ) : (
                      <>
                        <Upload className={`w-12 h-12 mx-auto mb-3
                          ${isDark ? 'text-zinc-600' : 'text-zinc-400'}`} />
                        <p className={`font-medium mb-1
                          ${isDark ? 'text-white' : 'text-zinc-900'}`}>
                          Click to upload or drag and drop
                        </p>
                        <p className={`text-sm
                          ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                          Images: JPG, PNG, GIF, WebP (max 10MB)
                        </p>
                        <p className={`text-sm
                          ${isDark ? 'text-zinc-400' : 'text-zinc-600'}`}>
                          Videos: MP4, WebM, MOV (max 50MB)
                        </p>
                      </>
                    )}
                  </div>
                </div>
                {fileError && (
                  <p className="mt-2 text-sm text-red-500">{fileError}</p>
                )}
              </div>

              {/* Preview */}
              {selectedFile && (
                <div className={`p-4 rounded-lg border
                  ${isDark ? 'bg-zinc-800/50 border-zinc-700' : 'bg-zinc-50 border-zinc-200'}`}>
                  <p className={`text-sm font-medium mb-2
                    ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    Preview
                  </p>
                  <div className="relative w-full aspect-video rounded-lg overflow-hidden">
                    {mediaType === 'video' ? (
                      <video
                        src={URL.createObjectURL(selectedFile)}
                        className="w-full h-full object-contain bg-black"
                        controls
                      />
                    ) : (
                      <img
                        src={URL.createObjectURL(selectedFile)}
                        alt="Preview"
                        className="w-full h-full object-contain bg-zinc-900"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Title Input */}
              <div>
                <label className={`block text-sm font-medium mb-2
                  ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  Title (Optional)
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={selectedFile?.name || 'Give your media a title'}
                  className={`w-full px-4 py-2 rounded-lg border transition-colors
                    ${isDark 
                      ? 'bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500 focus:border-blue-500' 
                      : 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-blue-500'}
                    outline-none`}
                />
              </div>

              {/* Description Input */}
              <div>
                <label className={`block text-sm font-medium mb-2
                  ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  Description (Optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add a description"
                  rows={3}
                  className={`w-full px-4 py-2 rounded-lg border transition-colors resize-none
                    ${isDark 
                      ? 'bg-zinc-800 border-zinc-700 text-white placeholder-zinc-500 focus:border-blue-500' 
                      : 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400 focus:border-blue-500'}
                    outline-none`}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode('type-selection')
                    setSelectedFile(null)
                    setFileError('')
                  }}
                  disabled={isProcessing}
                  className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors
                    ${isDark 
                      ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-50' 
                      : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 disabled:opacity-50'}`}
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={!selectedFile || isProcessing}
                  className="flex-1 px-4 py-2 rounded-lg font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isProcessing ? 'Uploading...' : 'Add Media'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
