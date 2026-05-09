'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { identifyUser, trackEvent } from '@/lib/analytics'

export function AnalyticsEvents() {
  const pathname = usePathname()
  const { user, status } = useAuth()
  const lastUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (status === 'loading') return
    const nextUserId = user?.id ?? null
    if (lastUserIdRef.current === nextUserId) return
    lastUserIdRef.current = nextUserId
    identifyUser(user)
  }, [status, user])

  useEffect(() => {
    trackEvent('page_viewed', {
      path: pathname || '/',
      authenticated: status === 'authenticated',
    })
  }, [pathname, status])

  return null
}
