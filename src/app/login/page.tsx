'use client'

import { useState, useEffect, Suspense } from 'react'
import { motion } from 'framer-motion'
import { Mail, Lock, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@/components/AuthProvider'
import { createClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { status } = useAuth()
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [isLoading, setIsLoading] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [showResendVerification, setShowResendVerification] = useState(false)
  const [isResending, setIsResending] = useState(false)

  // Check for OAuth error in URL
  useEffect(() => {
    const error = searchParams.get('error')
    if (error) {
      if (error === 'OAuthAccountNotLinked') {
        toast.error('This email is already registered. Please sign in with your password.')
      } else if (error === 'OAuthCallback') {
        toast.error('Google sign-in failed. Please try again.')
      } else if (error !== 'SessionRequired') {
        toast.error(error)
      }
    }
  }, [searchParams])

  // Redirect if already logged in
  useEffect(() => {
    if (status === 'authenticated') {
      const callbackUrl = searchParams.get('callbackUrl') || '/'
      router.push(callbackUrl)
    }
  }, [status, router, searchParams])

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {}

    if (!email) {
      newErrors.email = 'Email is required'
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      newErrors.email = 'Email is invalid'
    }

    if (!password) {
      newErrors.password = 'Password is required'
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) return

    setIsLoading(true)
    setShowResendVerification(false)
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        const errorLower = error.message.toLowerCase()
        if (errorLower.includes('email not confirmed') || errorLower.includes('not verified')) {
          setShowResendVerification(true)
        }
        toast.error(error.message)
        setIsLoading(false)
        return
      }

      if (data.session) {
        const callbackUrl = searchParams.get('callbackUrl') || '/'
        router.push(callbackUrl)
      }
    } catch (error) {
      toast.error('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true)
    try {
      const callbackUrl = searchParams.get('callbackUrl') || '/'
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(callbackUrl)}`,
        },
      })
      if (error) {
        toast.error(error.message)
        setIsGoogleLoading(false)
      }
    } catch (error) {
      toast.error('Google sign-in failed. Please try again.')
      setIsGoogleLoading(false)
    }
  }

  const handleResendVerification = async () => {
    if (!email) {
      toast.error('Please enter your email address')
      return
    }

    setIsResending(true)
    
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      })

      const data = await response.json()

      if (response.ok) {
        toast.success(data.message)
        setShowResendVerification(false)
      } else {
        toast.error(data.error || 'Failed to resend verification email')
      }
    } catch (error) {
      console.error('Resend verification error:', error)
      toast.error('An error occurred. Please try again.')
    } finally {
      setIsResending(false)
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
          {/* Login Card */}
          <div className="bg-white/20 backdrop-blur-xl rounded-2xl shadow-2xl p-8">
            {/* Header */}
            <div className="text-center mb-8">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                className="w-16 h-16 bg-black rounded-xl mx-auto mb-4 flex items-center justify-center p-3"
              >
                <img src="/bordclear.png" alt="BORDS" className="w-full h-full object-contain" />
              </motion.div>
              <h1 className="text-3xl font-semibold text-white mb-2 brand-font tracking-tight">
                Welcome
              </h1>
              <p className="text-zinc-300 font-light">
                Sign in to continue to BORDS
              </p>
            </div>

            {/* Google Sign In */}
            <motion.button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isGoogleLoading || isLoading}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="w-full py-3.5 bg-white hover:bg-zinc-50 text-zinc-700 rounded-xl font-medium shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 border border-zinc-200 mb-6"
            >
              {isGoogleLoading ? (
                <div className="w-5 h-5 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
              ) : (
                <>
                  <GoogleIcon className="w-5 h-5" />
                  Continue with Google
                </>
              )}
            </motion.button>

            {/* Divider */}
            <div className="flex justify-center mb-6">
              <span className="text-sm text-zinc-400 font-light">or sign in with email</span>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email Field */}
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
                    className={`w-full pl-12 pr-4 py-3 bg-white border ${
                      errors.email ? 'border-red-500' : 'border-zinc-300'
                    } rounded-xl focus:outline-none focus:ring-2 focus:ring-[#bfdbfe] focus:border-[#bfdbfe] transition-all text-black placeholder:text-zinc-400 font-light`}
                    placeholder="you@example.com"
                  />
                </div>
                {errors.email && (
                  <p className="mt-1 text-sm text-red-500 font-light">{errors.email}</p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <label className="block text-sm font-medium text-white mb-2">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="w-5 h-5 text-zinc-400" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`w-full pl-12 pr-12 py-3 bg-white border ${
                      errors.password ? 'border-red-500' : 'border-zinc-300'
                    } rounded-xl focus:outline-none focus:ring-2 focus:ring-[#bfdbfe] focus:border-[#bfdbfe] transition-all text-black placeholder:text-zinc-400 font-light`}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center"
                  >
                    {showPassword ? (
                      <EyeOff className="w-5 h-5 text-zinc-400 hover:text-zinc-600 transition-colors" />
                    ) : (
                      <Eye className="w-5 h-5 text-zinc-400 hover:text-zinc-600 transition-colors" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p className="mt-1 text-sm text-red-500 font-light">{errors.password}</p>
                )}
              </div>

              {/* Forgot Password */}
              <div className="flex items-center justify-end">
                <Link href="/forgot-password" className="text-sm text-[#bfdbfe] hover:text-white transition-colors">
                  Forgot password?
                </Link>
              </div>

              {/* Submit Button */}
              <motion.button
                type="submit"
                disabled={isLoading || isGoogleLoading}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="w-full py-4 bg-black text-white rounded-xl font-medium shadow-sm hover:bg-zinc-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  </div>
                ) : (
                  'Sign In'
                )}
              </motion.button>

              {/* Resend Verification Email */}
              {showResendVerification && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-black/40 border border-white/20 rounded-xl"
                >
                  <p className="text-sm text-white mb-3 font-light">
                    Your email address hasn&apos;t been verified yet. Check your inbox or resend the verification email.
                  </p>
                  <button
                    type="button"
                    onClick={handleResendVerification}
                    disabled={isResending}
                    className="w-full py-2 bg-white hover:bg-zinc-100 text-black rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                  >
                    {isResending ? (
                      <div className="flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                      </div>
                    ) : (
                      'Resend Verification Email'
                    )}
                  </button>
                </motion.div>
              )}
            </form>

            {/* Sign Up Link */}
            <p className="mt-6 text-center text-sm text-zinc-200 font-light">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="text-[#bfdbfe] hover:text-white font-medium transition-colors">
                Sign up
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
