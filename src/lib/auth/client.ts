'use client'

import { createAuthClient } from 'better-auth/react'

/** Browser auth client. Same-origin, so it needs no baseURL. */
export const authClient = createAuthClient()
