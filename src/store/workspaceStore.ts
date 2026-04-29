import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/* ─────────────── Types ─────────────── */

export interface WorkspaceOrg {
  _id: string
  name: string
  ownerId: string
  isOwner: boolean
  role?: 'admin' | 'member'
}

export interface PersonalWorkspace {
  _id: string
  type: 'personal'
  name: string
}

export interface OrgContainerWorkspace {
  _id: string
  type: 'organization_container'
  name: string
  organizations: WorkspaceOrg[]
}

export type ActiveContext =
  | { type: 'personal'; workspaceId: string }
  | { type: 'organization'; workspaceId: string; organizationId: string; organizationName: string }

export interface Friend {
  _id: string
  userId: string
  email: string
  nickname?: string
  firstName: string
  lastName: string
  image: string
  status: 'pending' | 'accepted'
}

interface WorkspaceStore {
  // Data
  personalWorkspace: PersonalWorkspace | null
  orgContainerWorkspace: OrgContainerWorkspace | null
  activeContext: ActiveContext | null
  friends: Friend[]
  isLoaded: boolean
  isLoading: boolean

  // Actions
  fetchWorkspaces: () => Promise<void>
  setActiveContext: (ctx: ActiveContext) => void
  switchToPersonal: () => void
  switchToOrganization: (orgId: string, orgName: string) => void

  // Friends
  fetchFriends: () => Promise<void>
  addFriend: (email: string, nickname?: string) => Promise<{ success: boolean; error?: string; invited?: boolean; message?: string }>
  removeFriend: (friendId: string) => Promise<void>

  // Helpers
  isPersonalContext: () => boolean
  isOrgContext: () => boolean
  getActiveOrgId: () => string | null
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      personalWorkspace: null,
      orgContainerWorkspace: null,
      activeContext: null,
      friends: [],
      isLoaded: false,
      isLoading: false,

      fetchWorkspaces: async () => {
        if (get().isLoading) return
        set({ isLoading: true })

        try {
          const res = await fetch('/api/workspaces')
          if (!res.ok) throw new Error('Failed to fetch workspaces')
          const data = await res.json()

          const personal = data.workspaces.personal as PersonalWorkspace
          const orgContainer = data.workspaces.organizationContainer as OrgContainerWorkspace

          set({
            personalWorkspace: personal,
            orgContainerWorkspace: orgContainer,
            isLoaded: true,
            isLoading: false,
            // Default to personal if no active context set
            activeContext: get().activeContext || {
              type: 'personal',
              workspaceId: personal._id,
            },
          })
        } catch (error) {
          console.error('Failed to fetch workspaces:', error)
          set({ isLoading: false })
        }
      },

      setActiveContext: (ctx) => set({ activeContext: ctx }),

      switchToPersonal: () => {
        const { personalWorkspace, activeContext } = get()
        if (!personalWorkspace) return
        // Only reset board if actually switching contexts
        if (activeContext?.type !== 'personal') {
          // Reset current board — the new context has its own boards
          try {
            const { useBoardStore } = require('./boardStore')
            useBoardStore.getState().setCurrentBoard(null)
          } catch { /* ignore */ }
        }
        set({
          activeContext: {
            type: 'personal',
            workspaceId: personalWorkspace._id,
          },
        })
      },

      switchToOrganization: (orgId, orgName) => {
        const { orgContainerWorkspace, activeContext } = get()
        if (!orgContainerWorkspace) return
        // Only reset board if switching to a different org (or from personal)
        const isSameOrg = activeContext?.type === 'organization' && 
          (activeContext as any).organizationId === orgId
        if (!isSameOrg) {
          try {
            const { useBoardStore } = require('./boardStore')
            useBoardStore.getState().setCurrentBoard(null)
          } catch { /* ignore */ }
        }
        set({
          activeContext: {
            type: 'organization',
            workspaceId: orgContainerWorkspace._id,
            organizationId: orgId,
            organizationName: orgName,
          },
        })
      },

      fetchFriends: async () => {
        try {
          const res = await fetch('/api/workspaces/friends')
          if (!res.ok) return
          const data = await res.json()
          set({ friends: data.friends || [] })
        } catch {
          /* silent */
        }
      },

      addFriend: async (email, nickname) => {
        try {
          const res = await fetch('/api/workspaces/friends', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, nickname }),
          })
          const data = await res.json()
          if (!res.ok) return { success: false, error: data.error }

          // User doesn't exist yet — invite was sent
          if (data.invited) {
            return { success: true, invited: true, message: data.message }
          }

          set(s => ({ friends: [data.friend, ...s.friends] }))
          return { success: true }
        } catch {
          return { success: false, error: 'Network error' }
        }
      },

      removeFriend: async (friendId) => {
        try {
          const res = await fetch(`/api/workspaces/friends/${friendId}`, {
            method: 'DELETE',
          })
          if (res.ok) {
            set(s => ({ friends: s.friends.filter(f => f._id !== friendId) }))
          }
        } catch {
          /* silent */
        }
      },

      isPersonalContext: () => get().activeContext?.type === 'personal',
      isOrgContext: () => get().activeContext?.type === 'organization',
      getActiveOrgId: () => {
        const ctx = get().activeContext
        return ctx?.type === 'organization' ? ctx.organizationId : null
      },
    }),
    {
      name: 'workspace-storage',
      partialize: (state) => ({
        activeContext: state.activeContext,
      }),
    }
  )
)
