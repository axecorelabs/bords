'use client'

import { createContext, useContext, useEffect, useState, useMemo, ReactNode, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { User, Session } from '@supabase/supabase-js'
import { useRouter } from 'next/navigation'

interface AuthUser {
  id: string
  email: string
  name: string
  image: string
}

interface AuthContextType {
  user: AuthUser | null
  session: Session | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
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

function mapUser(supaUser: User): AuthUser {
  const meta = supaUser.user_metadata || {}
  const firstName = meta.first_name || ''
  const lastName = meta.last_name || ''
  const fullName = meta.full_name || `${firstName} ${lastName}`.trim()
  return {
    id: supaUser.id,
    email: supaUser.email || '',
    name: fullName,
    image: meta.avatar_url || '',
  }
}

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading')
  const router = useRouter()
  const supabase = createClient()

  // Stable updater: only produce a new user object when values actually change
  // (prevents re-renders on Supabase token refresh that doesn't change user data)
  const stableSetUser = useCallback((supaUser: User) => {
    setUser(prev => {
      const next = mapUser(supaUser)
      if (prev && prev.id === next.id && prev.email === next.email &&
          prev.name === next.name && prev.image === next.image) {
        return prev
      }
      return next
    })
  }, [])

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (s?.user) {
        stableSetUser(s.user)
        setSession(s)
        setStatus('authenticated')
      } else {
        setUser(null)
        setSession(null)
        setStatus('unauthenticated')
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, s) => {
        if (s?.user) {
          stableSetUser(s.user)
          setSession(s)
          setStatus('authenticated')
        } else {
          setUser(null)
          setSession(null)
          setStatus('unauthenticated')
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [supabase, stableSetUser])

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }, [supabase, router])

  return (
    <AuthContext.Provider value={{ user, session, status, signOut: handleSignOut }}>
      {children}
    </AuthContext.Provider>
  )
}
