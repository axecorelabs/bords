/**
 * boardShareApi.ts — Share / permission API helpers extracted from
 * boardSyncStore so the store stays focused on sync orchestration.
 */

import { toast } from 'react-hot-toast'
import { trackEvent } from '@/lib/analytics'

export interface ShareEntry {
  userId: string
  email: string
  permission: 'view' | 'edit'
  addedAt: string
}

export async function getShareSettings(localBoardId: string): Promise<{ visibility: string; shareToken: string | null; sharedWith: ShareEntry[] } | null> {
  try {
    const res = await fetch(`/api/boards/sync/${localBoardId}/share`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function updateVisibility(localBoardId: string, visibility: 'private' | 'public' | 'shared'): Promise<void> {
  try {
    const res = await fetch(`/api/boards/sync/${localBoardId}/share`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility }),
    })
    if (!res.ok) throw new Error('Failed to update visibility')
    if (visibility === 'public' || visibility === 'shared') {
      trackEvent('board_shared', {
        boardId: localBoardId,
        visibility,
        shareMethod: 'visibility',
      })
    }
    toast.success(`Board is now ${visibility}`)
  } catch (error: any) {
    toast.error(error.message)
  }
}

export async function addShareUser(localBoardId: string, email: string, permission: 'view' | 'edit'): Promise<void> {
  try {
    const res = await fetch(`/api/boards/sync/${localBoardId}/share`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addEmail: email, permission }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Failed to share')
    }
    trackEvent('board_shared', {
      boardId: localBoardId,
      visibility: 'shared',
      shareMethod: 'email',
      permission,
    })
    trackEvent('invite_sent', {
      boardId: localBoardId,
      permission,
    })
    toast.success(`Shared with ${email}`)
  } catch (error: any) {
    toast.error(error.message)
  }
}

export async function removeShareUser(localBoardId: string, userId: string): Promise<void> {
  try {
    await fetch(`/api/boards/sync/${localBoardId}/share`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removeUserId: userId }),
    })
    toast.success('User removed from shared list')
  } catch (error: any) {
    toast.error(error.message)
  }
}

export async function updateSharePermission(localBoardId: string, userId: string, permission: 'view' | 'edit'): Promise<void> {
  try {
    await fetch(`/api/boards/sync/${localBoardId}/share`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updatePermission: { userId, permission } }),
    })
    toast.success('Permission updated')
  } catch (error: any) {
    toast.error(error.message)
  }
}
