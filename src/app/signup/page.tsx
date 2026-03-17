'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { User, Mail, Lock, Eye, EyeOff } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

export default function SignUpPage() {
  const router = useRouter()
  const { status } = useAuth()
  const supabase = createClient()
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [errors, setErrors] = useState<{
    firstName?: string
    lastName?: string
    email?: string
    password?: string
    confirmPassword?: string
  }>({})
  const [isLoading, setIsLoading] = useState(false)

  // Redirect if already logged in
  useEffect(() => {
    if (status === 'authenticated') {
      router.push('/')
    }
  }, [status, router])

  const validateForm = () => {
    const newErrors: {
      firstName?: string
      lastName?: string
      email?: string
      password?: string
      confirmPassword?: string
    } = {}

    if (!firstName) {
      newErrors.firstName = 'First name is required'
    } else if (firstName.length < 2) {
      newErrors.firstName = 'First name must be at least 2 characters'
    }

    if (!lastName) {
      newErrors.lastName = 'Last name is required'
    } else if (lastName.length < 2) {
      newErrors.lastName = 'Last name must be at least 2 characters'
    }

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

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your password'
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleGoogleSignUp = async () => {
    setIsGoogleLoading(true)
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?next=/`,
        },
      })
      if (error) {
        toast.error(error.message)
        setIsGoogleLoading(false)
      }
    } catch (error) {
      toast.error('Google sign-up failed. Please try again.')
      setIsGoogleLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!validateForm()) return

    setIsLoading(true)
    
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            full_name: `${firstName} ${lastName}`.trim(),
          },
          emailRedirectTo: `${window.location.origin}/api/auth/callback?next=/`,
        },
      })

      if (error) {
        toast.error(error.message)
        setIsLoading(false)
        return
      }

      // If email confirmation is required, Supabase returns user but no session
      if (data.user && !data.session) {
        toast.success('Account created! Please check your email to verify your account.')
        setTimeout(() => {
          router.push('/login')
        }, 2000)
      } else if (data.session) {
        // Auto-confirmed (e.g. dev mode)
        toast.success('Account created!')
        router.push('/')
      }
    } catch (error) {
      console.error('Signup error:', error)
      toast.error('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black relative">
      {/* Background Image */}
      <div 
        className="fixed inset-0 bg-cover bg-center opacity-10 -z-10"
        style={{ backgroundImage: 'url(/bord2.png)' }}
      />
      
      {/* Semi-transparent blur overlay */}
      <div className="fixed inset-0 backdrop-blur-[2px] bg-black/50 -z-10" />

      <div className="relative flex items-center justify-center min-h-screen p-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          {/* Sign Up Card */}
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
                Create Account
              </h1>
              <p className="text-zinc-300 font-light">
                Join BORDS and start organizing visually
              </p>
            </div>

            {/* Google Sign Up */}
            <motion.button
              type="button"
              onClick={handleGoogleSignUp}
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
            <div className="relative mb-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/20" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-4 text-zinc-400 bg-transparent font-light">or sign up with email</span>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* First Name and Last Name Fields - Side by Side */}
              <div className="grid grid-cols-2 gap-4">
                {/* First Name Field */}
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    First Name
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <User className="w-5 h-5 text-zinc-400" />
                    </div>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      className={`w-full pl-12 pr-4 py-3 bg-white border ${
                        errors.firstName ? 'border-red-500' : 'border-zinc-300'
                      } rounded-xl focus:outline-none focus:ring-2 focus:ring-[#bfdbfe] focus:border-[#bfdbfe] transition-all text-black placeholder:text-zinc-400 font-light`}
                      placeholder="John"
                    />
                  </div>
                  {errors.firstName && (
                    <p className="mt-1 text-sm text-red-500 font-light">{errors.firstName}</p>
                  )}
                </div>

                {/* Last Name Field */}
                <div>
                  <label className="block text-sm font-medium text-white mb-2">
                    Last Name
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <User className="w-5 h-5 text-zinc-400" />
                    </div>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className={`w-full pl-12 pr-4 py-3 bg-white border ${
                        errors.lastName ? 'border-red-500' : 'border-zinc-300'
                      } rounded-xl focus:outline-none focus:ring-2 focus:ring-[#bfdbfe] focus:border-[#bfdbfe] transition-all text-black placeholder:text-zinc-400 font-light`}
                      placeholder="Doe"
                    />
                  </div>
                  {errors.lastName && (
                    <p className="mt-1 text-sm text-red-500 font-light">{errors.lastName}</p>
                  )}
                </div>
              </div>

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

              {/* Confirm Password Field */}
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

              {/* Terms & Conditions */}
              <div className="flex items-start">
                <input
                  type="checkbox"
                  className="w-4 h-4 mt-1 text-black border-zinc-300 rounded focus:ring-[#bfdbfe]"
                  required
                />
                <label className="ml-2 text-sm text-zinc-200 font-light">
                  I agree to the{' '}
                  <a href="#" className="text-[#bfdbfe] hover:text-white transition-colors">
                    Terms and Conditions
                  </a>{' '}
                  and{' '}
                  <a href="#" className="text-[#bfdbfe] hover:text-white transition-colors">
                    Privacy Policy
                  </a>
                </label>
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
                  'Create Account'
                )}
              </motion.button>
            </form>

            {/* Login Link */}
            <p className="mt-6 text-center text-sm text-zinc-200 font-light">
              Already have an account?{' '}
              <Link href="/login" className="text-[#bfdbfe] hover:text-white font-medium transition-colors">
                Sign in
              </Link>
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
