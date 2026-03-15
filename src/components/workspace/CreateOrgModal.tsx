'use client'

import { useState, useRef } from 'react'
import { X, Building2, Loader2, Camera } from 'lucide-react'
import { useThemeStore } from '@/store/themeStore'
import { useOrganizationStore } from '@/store/organizationStore'
import { useWorkspaceStore } from '@/store/workspaceStore'
import { motion } from 'framer-motion'

interface Props {
  isOpen: boolean
  onClose: () => void
}

/**
 * CreateOrgModal — Focused modal for creating a new organization.
 * After creation it refreshes both the org store and workspace store,
 * then auto-switches context to the new org.
 */
export function CreateOrgModal({ isOpen, onClose }: Props) {
  const isDark = useThemeStore((s) => s.isDark)
  const { createOrganization, isLoading } = useOrganizationStore()
  const { fetchWorkspaces, switchToOrganization } = useWorkspaceStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  if (!isOpen) return null

  const initials = name.trim()
    ? name.trim().split(/\s+/).slice(0, 2).map(w => w[0].toUpperCase()).join('')
    : ''

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Logo must be under 5 MB')
      return
    }
    setError('')
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  const uploadLogo = async (): Promise<string | undefined> => {
    if (!logoFile) return undefined
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', logoFile)
      formData.append('folder', 'org-logos')
      const res = await fetch('/api/media/upload', { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      return data.url as string
    } catch (err: any) {
      setError(err.message)
      return undefined
    } finally {
      setUploading(false)
    }
  }

  const handleCreate = async () => {
    if (!name.trim()) return
    setError('')
    const logoUrl = await uploadLogo()
    if (logoFile && !logoUrl) return // upload failed

    const org = await createOrganization({
      name: name.trim(),
      description: description.trim() || undefined,
      logoUrl,
    })
    if (org) {
      setName('')
      setDescription('')
      setLogoPreview(null)
      setLogoFile(null)
      await fetchWorkspaces()
      switchToOrganization(org._id, org.name)
      onClose()
    } else {
      setError(useOrganizationStore.getState().error || 'Failed to create organization')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        className={`w-full max-w-md mx-4 rounded-2xl shadow-2xl border overflow-hidden ${
          isDark ? 'bg-zinc-800 border-zinc-700' : 'bg-white border-zinc-200'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${
          isDark ? 'border-zinc-700' : 'border-zinc-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isDark ? 'bg-zinc-700' : 'bg-zinc-100'}`}>
              <Building2 size={18} className={isDark ? 'text-zinc-300' : 'text-zinc-600'} />
            </div>
            <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-zinc-900'}`}>
              New Organization
            </h3>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-lg ${isDark ? 'hover:bg-zinc-700 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'}`}
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Logo Picker */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`relative w-20 h-20 rounded-full flex items-center justify-center overflow-hidden border-2 border-dashed transition-colors ${
                isDark
                  ? 'border-zinc-600 hover:border-zinc-500 bg-zinc-900'
                  : 'border-zinc-300 hover:border-zinc-400 bg-zinc-50'
              }`}
            >
              {logoPreview ? (
                <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
              ) : initials ? (
                <span className={`text-xl font-bold ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
                  {initials}
                </span>
              ) : (
                <Camera size={22} className={isDark ? 'text-zinc-500' : 'text-zinc-400'} />
              )}
              <div className={`absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded-full ${
                isDark ? 'bg-black/50' : 'bg-black/30'
              }`}>
                <Camera size={18} className="text-white" />
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoSelect}
            />
          </div>
          <p className={`text-center text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            Optional logo
          </p>

          <div>
            <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
              Organization Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Acme Inc."
              autoFocus
              className={`w-full px-4 py-3 rounded-xl border text-sm transition-colors ${
                isDark
                  ? 'bg-zinc-900 border-zinc-600 text-white placeholder:text-zinc-500 focus:border-zinc-500'
                  : 'bg-white border-zinc-300 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400'
              } focus:outline-none focus:ring-2 focus:ring-blue-500/20`}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          <div>
            <label className={`block text-sm font-medium mb-1.5 ${isDark ? 'text-zinc-300' : 'text-zinc-700'}`}>
              Description <span className={isDark ? 'text-zinc-500' : 'text-zinc-400'}>(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does your organization do?"
              rows={2}
              className={`w-full px-4 py-3 rounded-xl border text-sm transition-colors resize-none ${
                isDark
                  ? 'bg-zinc-900 border-zinc-600 text-white placeholder:text-zinc-500 focus:border-zinc-500'
                  : 'bg-white border-zinc-300 text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400'
              } focus:outline-none focus:ring-2 focus:ring-blue-500/20`}
            />
          </div>

          <p className={`text-xs leading-relaxed ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
            Organizations let you delegate tasks, manage teams, and collaborate on boards.
            You&apos;ll be the owner and can invite team members after creation.
          </p>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 flex gap-3 justify-end border-t ${isDark ? 'border-zinc-700' : 'border-zinc-200'}`}>
          <button
            onClick={onClose}
            className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              isDark ? 'text-zinc-400 hover:bg-zinc-700' : 'text-zinc-600 hover:bg-zinc-100'
            }`}
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || isLoading || uploading}
            className={`px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 ${
              isDark
                ? 'bg-white text-black hover:bg-zinc-200 disabled:opacity-40'
                : 'bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-40'
            }`}
          >
            {(isLoading || uploading) && <Loader2 size={14} className="animate-spin" />}
            Create Organization
          </button>
        </div>
      </motion.div>
    </div>
  )
}
