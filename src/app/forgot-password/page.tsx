'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Mail, ArrowLeft, Send } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const { status } = useAuth()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)

  // Redirect if already logged in
  useEffect(() => {
    if (status === 'authenticated') {
      router.push('/')
    }
  }, [status, router])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email) {
      toast.error('Please enter your email address')
      return
    }

    if (!/\S+@\S+\.\S+/.test(email)) {
      toast.error('Please enter a valid email address')
      return
    }

    setIsLoading(true)

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (error) {
        toast.error(error.message)
      } else {
        setIsSubmitted(true)
        toast.success('If an account exists with this email, you will receive password reset instructions.')
      }
    } catch (error) {
      console.error('Forgot password error:', error)
      toast.error('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black">
      {/* Background Image */}
      <div 
        className="absolute inset-0 bg-cover bg-center opacity-10"
        style={{ backgroundImage: 'url(/bord2.png)' }}
      />
      
      {/* Semi-transparent blur overlay */}
      <div className="absolute inset-0 backdrop-blur-[2px] bg-black/50" />

      <div className="relative flex items-center justify-center min-h-screen p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <div className="bg-white/20 backdrop-blur-xl rounded-2xl shadow-2xl p-8">
            {!isSubmitted ? (
              <>
                {/* Header */}
                <div className="text-center mb-8">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                    className="w-16 h-16 bg-black rounded-xl mx-auto mb-4 flex items-center justify-center"
                  >
                    <Mail className="w-8 h-8 text-white" />
                  </motion.div>
                  <h1 className="text-3xl font-semibold text-white mb-2 brand-font tracking-tight">
                    Forgot Password?
                  </h1>
                  <p className="text-zinc-300 font-light">
                    Enter your email and we'll send you reset instructions
                  </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">
                      Email Address
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Mail className="w-5 h-5 text-zinc-400" />
                      </div>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full pl-12 pr-4 py-3 bg-white border border-zinc-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#bfdbfe] focus:border-[#bfdbfe] transition-all text-black placeholder:text-zinc-400 font-light"
                        placeholder="you@example.com"
                        disabled={isLoading}
                      />
                    </div>
                  </div>

                  <motion.button
                    type="submit"
                    disabled={isLoading}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full py-4 bg-black text-white rounded-xl font-medium shadow-sm hover:bg-zinc-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>
                        <Send className="w-5 h-5" />
                        Send Reset Link
                      </>
                    )}
                  </motion.button>
                </form>

                {/* Back to Login */}
                <div className="mt-6">
                  <Link
                    href="/login"
                    className="flex items-center justify-center gap-2 text-sm text-zinc-300 hover:text-white font-light transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Login
                  </Link>
                </div>
              </>
            ) : (
              <>
                {/* Success State */}
                <div className="text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 200 }}
                    className="w-16 h-16 bg-green-500 rounded-xl mx-auto mb-6 flex items-center justify-center"
                  >
                    <Send className="w-8 h-8 text-white" />
                  </motion.div>
                  <h2 className="text-2xl font-semibold text-white mb-2 brand-font tracking-tight">
                    Check Your Email
                  </h2>
                  <p className="text-zinc-300 font-light mb-6">
                    If an account exists with <strong className="text-white">{email}</strong>, you will receive password reset instructions.
                  </p>
                  <Link
                    href="/login"
                    className="inline-block w-full py-4 bg-black hover:bg-zinc-900 text-white rounded-xl font-medium shadow-sm transition-all"
                  >
                    Back to Login
                  </Link>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
