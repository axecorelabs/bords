'use client'

import { createContext, useContext, useMemo, ReactNode, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

interface AuthUser {
  id: string
  email: string
  name: string
  image: string
}

interface AuthContextType {
  user: AuthUser | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  status: 'loading',
  signOut: async () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

// Compatibility shim: drop-in replacement for useSession
export function useSession() {
  const { user, status } = useAuth()
  // Memoize so the returned object is referentially stable between renders.
  // Without this, every consumer that puts session in a useEffect dep array
  // would re-fire on every render (new object identity each time).
  const data = useMemo(() => (user ? { user } : null), [user])
  return useMemo(() => ({ data, status }), [data, status])
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { data, isPending } = authClient.useSession()

  const id = data?.user.id
  const email = data?.user.email ?? ''
  const name = data?.user.name ?? ''
  const image = data?.user.image ?? ''

  // Only produce a new user object when a value actually changes, so session
  // refetches (window focus, token refresh) don't re-render every consumer.
  const user = useMemo<AuthUser | null>(
    () => (id ? { id, email, name, image } : null),
    [id, email, name, image]
  )

  const status: AuthContextType['status'] = isPending ? 'loading' : user ? 'authenticated' : 'unauthenticated'

  const handleSignOut = useCallback(async () => {
    await authClient.signOut()
    router.push('/login')
  }, [router])

  const value = useMemo(() => ({ user, status, signOut: handleSignOut }), [user, status, handleSignOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
