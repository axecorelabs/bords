'use client'

import { useState } from 'react'
import {
  Loader2,
  Trash2,
  Camera,
  Save,
} from 'lucide-react'
import { DashboardData, RouterType } from './types'

export default function SettingsTab({
  data,
  isDark,
  orgId,
  onRefresh,
  router,
}: {
  data: DashboardData
  isDark: boolean
  orgId: string
  onRefresh: () => void
  router: RouterType
}) {
  const [name, setName] = useState(data.organization.name)
  const [description, setDescription] = useState(data.organization.description || '')
  const [logoPreview, setLogoPreview] = useState<string | null>(data.organization.logoUrl)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState('')

  const handleLogoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Please select an image'); return }
    if (file.size > 5 * 1024 * 1024) { setError('Logo must be under 5 MB'); return }
    setError('')
    setLogoFile(file)
    setLogoPreview(URL.createObjectURL(file))
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setIsSaving(true)
    setError('')
    setSaveSuccess(false)

    try {
      let logoUrl = data.organization.logoUrl
      if (logoFile) {
        const formData = new FormData()
        formData.append('file', logoFile)
        formData.append('folder', 'org-logos')
        const uploadRes = await fetch('/api/media/upload', { method: 'POST', body: formData })
        const uploadData = await uploadRes.json()
        if (!uploadRes.ok) throw new Error(uploadData.error || 'Logo upload failed')
        logoUrl = uploadData.url
      }

      const res = await fetch(`/api/organizations/${orgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), logoUrl }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to update')
      }
      setSaveSuccess(true)
      setLogoFile(null)
      onRefresh()
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/organizations/${orgId}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to delete')
      }
      router.push('/')
    } catch (err: any) {
      setError(err.message)
      setIsDeleting(false)
    }
  }

  return (
    <div>
      <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
        Settings
      </h1>
      <p className={`text-sm mb-8 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
        Manage your organization settings
      </p>

      {/* General settings */}
      <div className={`rounded-2xl border p-6 mb-6 ${
        isDark ? 'bg-zinc-800/50 border-zinc-700/50' : 'bg-white border-zinc-200'
      }`}>
        <h3 className={`font-semibold text-sm mb-5 ${isDark ? 'text-white' : 'text-zinc-900'}`}>
          General
        </h3>

        {/* Logo */}
        <div className="flex items-center gap-5 mb-6">
          <div className="relative group">
            {logoPreview ? (
              <img src={logoPreview} alt="" className="w-16 h-16 rounded-2xl object-cover" />
            ) : (
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-lg font-bold ${
                isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-600'
              }`}>
                {name.charAt(0).toUpperCase()}
              </div>
            )}
            <label className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
              <Camera size={18} className="text-white" />
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoSelect} />
            </label>
          </div>
          <div>
            <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>
              Organization Logo
            </p>
            <p className={`text-xs ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
              PNG, JPG up to 5 MB
            </p>
          </div>
        </div>

        {/* Name */}
        <div className="mb-4">
          <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            Organization Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`w-full px-4 py-3 rounded-xl border text-sm ${
              isDark
                ? 'bg-zinc-900 border-zinc-600 text-white placeholder:text-zinc-500'
                : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400'
            } focus:outline-none focus:ring-2 focus:ring-blue-500/30`}
          />
        </div>

        {/* Description */}
        <div className="mb-5">
          <label className={`block text-xs font-medium mb-1.5 ${isDark ? 'text-zinc-400' : 'text-zinc-500'}`}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className={`w-full px-4 py-3 rounded-xl border text-sm resize-none ${
              isDark
                ? 'bg-zinc-900 border-zinc-600 text-white placeholder:text-zinc-500'
                : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder:text-zinc-400'
            } focus:outline-none focus:ring-2 focus:ring-blue-500/30`}
            placeholder="What does your organization do?"
          />
        </div>

        {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
        {saveSuccess && <p className="text-xs text-emerald-500 mb-3">Settings saved successfully</p>}

        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors flex items-center gap-2"
        >
          {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save Changes
        </button>
      </div>

      {/* Danger zone */}
      <div className={`rounded-2xl border p-6 ${
        isDark ? 'bg-red-500/5 border-red-500/20' : 'bg-red-50/50 border-red-200'
      }`}>
        <h3 className={`font-semibold text-sm mb-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>
          Danger Zone
        </h3>
        <p className={`text-xs mb-4 ${isDark ? 'text-zinc-500' : 'text-zinc-400'}`}>
          Deleting an organization will remove all members, boards, and assignments permanently.
        </p>

        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold border transition-colors ${
              isDark
                ? 'border-red-500/30 text-red-400 hover:bg-red-500/10'
                : 'border-red-300 text-red-600 hover:bg-red-100'
            }`}
          >
            Delete Organization
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              Yes, Delete Forever
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium ${
                isDark ? 'text-zinc-400 hover:text-zinc-200' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
