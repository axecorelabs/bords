'use client'

import { useState, useEffect, Suspense } from 'react'
import { motion } from 'framer-motion'
import { Lock, Eye, EyeOff, CheckCircle, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const [errors, setErrors] = useState<{ password?: string; confirmPassword?: string }>({})

  useEffect(() => {
    setIsReady(Boolean(token && token.trim()))
  }, [token])

  const validateForm = () => {
    const newErrors: { password?: string; confirmPassword?: string } = {}

    if (!password) {
      newErrors.password = 'Password is required'
    } else if (password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters'
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password'
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return
    if (!token) return

    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token, password }),
      })
      const result = await response.json().catch(() => ({}))

      if (!response.ok) {
        toast.error(result?.error || 'Unable to reset password. Please try again.')
      } else {
        setIsSuccess(true)
        toast.success('Password reset successfully!')
        setTimeout(() => {
          router.push('/login')
        }, 2000)
      }
    } catch (error) {
      console.error('Reset password error:', error)
      toast.error('An error occurred. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isReady && !isSuccess) {
    return (
      <div className="fixed inset-0 bg-black">
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-10"
          style={{ backgroundImage: 'url(/bord2.png)' }}
        />
        <div className="absolute inset-0 backdrop-blur-[2px] bg-black/50" />
        
        <div className="relative flex items-center justify-center min-h-screen p-4">
          <div className="bg-white/20 backdrop-blur-xl rounded-2xl shadow-2xl p-8 max-w-md w-full text-center">
            <h1 className="text-2xl font-semibold text-white mb-2 brand-font tracking-tight">
              Invalid Reset Link
            </h1>
            <p className="text-zinc-300 font-light mb-6">
              This password reset link is invalid or has expired.
            </p>
            <Link
              href="/forgot-password"
              className="inline-block w-full py-4 bg-black hover:bg-zinc-900 text-white rounded-xl font-medium shadow-sm transition-all"
            >
              Request New Link
            </Link>
          </div>
        </div>
      </div>
    )
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
            {!isSuccess ? (
              <>
                {/* Header */}
                <div className="text-center mb-8">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                    className="w-16 h-16 bg-black rounded-xl mx-auto mb-4 flex items-center justify-center"
                  >
                    <Lock className="w-8 h-8 text-white" />
                  </motion.div>
                  <h1 className="text-3xl font-semibold text-white mb-2 brand-font tracking-tight">
                    Reset Password
                  </h1>
                  <p className="text-zinc-300 font-light">
                    Enter your new password below
                  </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* New Password */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">
                      New Password
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

                  {/* Confirm Password */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-2">
                      Confirm Password
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Lock className="w-5 h-5 text-zinc-400" />
                      </div>
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`w-full pl-12 pr-12 py-3 bg-white border ${
                          errors.confirmPassword ? 'border-red-500' : 'border-zinc-300'
                        } rounded-xl focus:outline-none focus:ring-2 focus:ring-[#bfdbfe] focus:border-[#bfdbfe] transition-all text-black placeholder:text-zinc-400 font-light`}
                        placeholder="••••••••"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute inset-y-0 right-0 pr-4 flex items-center"
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="w-5 h-5 text-zinc-400 hover:text-zinc-600 transition-colors" />
                        ) : (
                          <Eye className="w-5 h-5 text-zinc-400 hover:text-zinc-600 transition-colors" />
                        )}
                      </button>
                    </div>
                    {errors.confirmPassword && (
                      <p className="mt-1 text-sm text-red-500 font-light">{errors.confirmPassword}</p>
                    )}
                  </div>

                  <motion.button
                    type="submit"
                    disabled={isLoading}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full py-4 bg-black text-white rounded-xl font-medium shadow-sm hover:bg-zinc-900 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoading ? (
                      <div className="flex items-center justify-center">
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      </div>
                    ) : (
                      'Reset Password'
                    )}
                  </motion.button>
                </form>
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
                    <CheckCircle className="w-8 h-8 text-white" />
                  </motion.div>
                  <h2 className="text-2xl font-semibold text-white mb-2 brand-font tracking-tight">
                    Password Reset!
                  </h2>
                  <p className="text-zinc-300 font-light mb-6">
                    Your password has been successfully reset. You can now log in with your new password.
                  </p>
                  <Link
                    href="/login"
                    className="inline-block w-full py-4 bg-black hover:bg-zinc-900 text-white rounded-xl font-medium shadow-sm transition-all"
                  >
                    Continue to Login
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

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="fixed inset-0 flex items-center justify-center bg-black">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
      </div>
    }>
      <ResetPasswordContent />
    </Suspense>
  )
}
