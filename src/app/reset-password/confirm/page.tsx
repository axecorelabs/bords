'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { motion } from 'framer-motion'
import { KeyRound } from 'lucide-react'
import { Loader2 } from 'lucide-react'

function ResetPasswordConfirmContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('t')
  const next = searchParams.get('next')
  const [isLoading, setIsLoading] = useState(false)

  const handleContinue = async () => {
    if (!token || isLoading) return
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/recovery-relay', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ t: token }),
      })

      if (!response.ok) {
        window.location.assign('/login?error=Recovery+link+expired+or+invalid')
        return
      }

      const data = (await response.json()) as { url?: string }
      if (!data.url) {
        window.location.assign('/login?error=Recovery+link+expired+or+invalid')
        return
      }

      window.location.assign(data.url)
    } catch {
      window.location.assign('/login?error=Recovery+link+expired+or+invalid')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-10"
        style={{ backgroundImage: 'url(/bord2.png)' }}
      />
      <div className="absolute inset-0 backdrop-blur-[2px] bg-black/50" />

      <div className="relative flex items-center justify-center min-h-screen p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="w-full max-w-md"
        >
          <div className="bg-white/20 backdrop-blur-xl rounded-2xl shadow-2xl p-8 text-center">
            <div className="w-16 h-16 bg-black rounded-xl mx-auto mb-4 flex items-center justify-center">
              <KeyRound className="w-8 h-8 text-white" />
            </div>

            <h1 className="text-2xl font-semibold text-white mb-2 brand-font tracking-tight">
              Confirm Password Reset
            </h1>
            <p className="text-zinc-300 font-light mb-6">
              Click continue to securely open your one-time password reset link.
            </p>

            {token ? (
              <button
                type="button"
                onClick={handleContinue}
                disabled={isLoading}
                className="inline-flex items-center justify-center w-full py-4 bg-black hover:bg-zinc-900 text-white rounded-xl font-medium shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Continue'}
              </button>
            ) : next ? (
              <a
                href={next}
                className="inline-block w-full py-4 bg-black hover:bg-zinc-900 text-white rounded-xl font-medium shadow-sm transition-all"
              >
                Continue
              </a>
            ) : (
              <Link
                href="/forgot-password"
                className="inline-block w-full py-4 bg-black hover:bg-zinc-900 text-white rounded-xl font-medium shadow-sm transition-all"
              >
                Request New Link
              </Link>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export default function ResetPasswordConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 bg-black flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
        </div>
      }
    >
      <ResetPasswordConfirmContent />
    </Suspense>
  )
}
