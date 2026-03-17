import { create } from 'zustand'
import type {
  OrganizationDTO,
  EmployeeDTO,
  InvitationDTO,
} from '@/types/delegation'

interface OrganizationStore {
  organizations: (OrganizationDTO & { role: string })[]
  currentOrgId: string | null
  employees: EmployeeDTO[]
  pendingInvitations: InvitationDTO[]
  isOwnerOfCurrentOrg: boolean
  isLoading: boolean
  error: string | null

  fetchOrganizations: () => Promise<void>
  createOrganization: (params: { name: string; description?: string; logoUrl?: string }) => Promise<OrganizationDTO | null>
  setCurrentOrg: (orgId: string | null) => void
  fetchEmployees: (orgId: string) => Promise<void>
  inviteEmployee: (orgId: string, email: string) => Promise<boolean>
  removeEmployee: (orgId: string, employeeId: string) => Promise<boolean>
  revokeInvitation: (orgId: string, invitationId: string) => Promise<boolean>
}

export const useOrganizationStore = create<OrganizationStore>((set, get) => ({
  organizations: [],
  currentOrgId: null,
  employees: [],
  pendingInvitations: [],
  isOwnerOfCurrentOrg: false,
  isLoading: false,
  error: null,

  fetchOrganizations: async () => {
    set({ isLoading: true, error: null })
    try {
      const res = await fetch('/api/organizations')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      set({ organizations: data.organizations })
      // Auto-select first org if none selected
      if (!get().currentOrgId && data.organizations.length > 0) {
        set({ currentOrgId: data.organizations[0]._id })
      }
    } catch (err: any) {
      set({ error: err.message })
    } finally {
      set({ isLoading: false })
    }
  },

  createOrganization: async ({ name, description, logoUrl }) => {
    set({ isLoading: true, error: null })
    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, logoUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const org = { ...data.organization, role: 'owner' }
      set((state) => ({
        organizations: [...state.organizations, org],
        currentOrgId: state.currentOrgId || org._id,
      }))
      return data.organization
    } catch (err: any) {
      set({ error: err.message })
      return null
    } finally {
      set({ isLoading: false })
    }
  },

  setCurrentOrg: (orgId) => set({ currentOrgId: orgId }),

  fetchEmployees: async (orgId) => {
    set({ isLoading: true, error: null })
    try {
      const res = await fetch(`/api/organizations/${orgId}/employees`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      set({
        employees: data.employees,
        pendingInvitations: data.pendingInvitations || [],
        isOwnerOfCurrentOrg: data.isOwner ?? true,
      })
    } catch (err: any) {
      set({ error: err.message })
    } finally {
      set({ isLoading: false })
    }
  },

  inviteEmployee: async (orgId, email) => {
    set({ error: null })
    try {
      const res = await fetch(`/api/organizations/${orgId}/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      // Refresh employee list
      await get().fetchEmployees(orgId)
      return true
    } catch (err: any) {
      set({ error: err.message })
      return false
    }
  },

  removeEmployee: async (orgId, employeeId) => {
    set({ error: null })
    try {
      const res = await fetch(`/api/organizations/${orgId}/employees/${employeeId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error)
      }
      set((state) => ({
        employees: state.employees.filter((e) => e._id !== employeeId),
      }))
      return true
    } catch (err: any) {
      set({ error: err.message })
      return false
    }
  },

  revokeInvitation: async (orgId, invitationId) => {
    set({ error: null })
    try {
      const res = await fetch(`/api/organizations/${orgId}/invitations/${invitationId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error)
      }
      set((state) => ({
        pendingInvitations: state.pendingInvitations.filter((i) => i._id !== invitationId),
      }))
      return true
    } catch (err: any) {
      set({ error: err.message })
      return false
    }
  },
}))
