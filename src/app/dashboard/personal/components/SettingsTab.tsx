'use client'

import { useState, useRef } from 'react'
import { Camera, Loader2, Save, User } from 'lucide-react'
import { PersonalDashboardData } from './types'

export default function SettingsTab({
  data,
  isDark,
  onProfileUpdated,
}: {
  data: PersonalDashboardData
  isDark: boolean
  onProfileUpdated: () => void
}) {
  const { profile } = data
  const [firstName, setFirstName] = useState(profile.firstName)
  const [lastName, setLastName] = useState(profile.lastName)
  const [imageUrl, setImageUrl] = useState(profile.image || '')
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const cardBg = isDark ? 'bg-zinc-800/50' : 'bg-white'
  const cardBorder = isDark ? 'border-zinc-700/50' : 'border-zinc-200'
  const mutedText = isDark ? 'text-zinc-400' : 'text-zinc-500'
  const inputBg = isDark ? 'bg-zinc-700/50 border-zinc-600 text-zinc-100 placeholder-zinc-500' : 'bg-zinc-50 border-zinc-200 text-zinc-900 placeholder-zinc-400'

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5MB')
      return
    }

    setIsUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folder', 'avatars')

      const res = await fetch('/api/media/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Upload failed')
      }
      const { url } = await res.json()
      setImageUrl(url)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsUploading(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, image: imageUrl }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save')
      }
      setSaved(true)
      onProfileUpdated()
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setIsSaving(false)
    }
  }

  const hasChanges =
    firstName !== profile.firstName ||
    lastName !== profile.lastName ||
    imageUrl !== (profile.image || '')

  const initials = `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase() || '?'

  return (
    <div>
      <h1 className={`text-2xl font-bold mb-1 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Settings</h1>
      <p className={`text-sm mb-8 ${mutedText}`}>Manage your profile and preferences</p>

      <div className={`${cardBg} border ${cardBorder} rounded-2xl p-6 max-w-2xl`}>
        <h3 className={`text-sm font-semibold mb-6 ${isDark ? 'text-white' : 'text-zinc-900'}`}>Profile</h3>

        {/* Avatar */}
        <div className="flex items-center gap-5 mb-8">
          <div className="relative group">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt="Profile"
                className="w-20 h-20 rounded-full object-cover"
              />
            ) : (
              <div className={`w-20 h-20 rounded-full flex items-center justify-center text-xl font-bold ${
                isDark ? 'bg-blue-500/15 text-blue-400' : 'bg-blue-50 text-blue-600'
              }`}>
                {initials}
              </div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={isUploading}
              className={`absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity ${
                isDark ? 'bg-black/60' : 'bg-black/40'
              }`}
            >
              {isUploading ? (
                <Loader2 size={20} className="animate-spin text-white" />
              ) : (
                <Camera size={20} className="text-white" />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              onChange={handleUpload}
              className="hidden"
            />
          </div>
          <div>
            <p className={`text-sm font-medium ${isDark ? 'text-zinc-200' : 'text-zinc-800'}`}>Profile picture</p>
            <p className={`text-xs mt-0.5 ${mutedText}`}>JPG, PNG, GIF or WebP. Max 5MB.</p>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={isUploading}
              className={`mt-2 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                isDark ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-600'
              }`}
            >
              {isUploading ? 'Uploading...' : 'Change photo'}
            </button>
          </div>
        </div>

        {/* Name fields */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${mutedText}`}>First name</label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={`w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-blue-500/30 transition-all ${inputBg}`}
              placeholder="First name"
            />
          </div>
          <div>
            <label className={`block text-xs font-medium mb-1.5 ${mutedText}`}>Last name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={`w-full px-3 py-2 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-blue-500/30 transition-all ${inputBg}`}
              placeholder="Last name"
            />
          </div>
        </div>

        {/* Email (read-only) */}
        <div className="mb-6">
          <label className={`block text-xs font-medium mb-1.5 ${mutedText}`}>Email</label>
          <input
            type="email"
            value={profile.email}
            disabled
            className={`w-full px-3 py-2 rounded-lg border text-sm opacity-60 cursor-not-allowed ${inputBg}`}
          />
        </div>

        {/* Error / success */}
        {error && (
          <p className="text-xs text-red-500 mb-4">{error}</p>
        )}
        {saved && (
          <p className="text-xs text-emerald-500 mb-4">Profile saved successfully!</p>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={isSaving || !hasChanges}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all ${
            hasChanges
              ? 'bg-blue-500 hover:bg-blue-600 text-white'
              : isDark ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed' : 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
          }`}
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {isSaving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
