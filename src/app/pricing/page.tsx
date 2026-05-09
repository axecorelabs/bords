'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from '@/components/AuthProvider'
import { trackEvent } from '@/lib/analytics'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'

interface Plan {
  _id: string
  name: string
  slug: string
  description: string
  price: number
  currency: string
  interval: 'monthly' | 'yearly'
  features: string[]
  maxBoards: number
  maxTasksPerBoard: number
  maxCollaborators: number
  hasAdvancedFeatures: boolean
}

export default function PricingPage() {
  const router = useRouter()
  const { data: session, status } = useSession()
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly')
  const [processingPlanId, setProcessingPlanId] = useState<string | null>(null)

  useEffect(() => {
    fetchPlans()
  }, [])

  const fetchPlans = async () => {
    try {
      const response = await fetch('/api/subscription/plans')
      const data = await response.json()
      
      if (data.success) {
        setPlans(data.data)
      }
    } catch (error) {
      console.error('Failed to fetch plans:', error)
      toast.error('Failed to load pricing plans')
    } finally {
      setLoading(false)
    }
  }

  const handleSelectPlan = async (planId: string) => {
    if (status !== 'authenticated') {
      toast.error('Please login to subscribe')
      router.push('/login?callbackUrl=/pricing')
      return
    }

    setProcessingPlanId(planId)
    const plan = plans.find((p) => p._id === planId)

    try {
      trackEvent('subscription_checkout_started', {
        planId,
        planSlug: plan?.slug,
        interval: plan?.interval,
        price: plan?.price,
      })

      const response = await fetch('/api/subscription/initialize-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      })

      const data = await response.json()

      if (data.success) {
        // Redirect to Paystack payment page
        window.location.href = data.data.authorizationUrl
      } else {
        trackEvent('subscription_checkout_failed', {
          planId,
          planSlug: plan?.slug,
          reason: data.error || 'initialize_payment_failed',
        })
        toast.error(data.error || 'Failed to initialize payment')
      }
    } catch (error) {
      trackEvent('subscription_checkout_failed', {
        planId,
        planSlug: plan?.slug,
        reason: 'exception',
      })
      console.error('Payment initialization error:', error)
      toast.error('Failed to start payment process')
    } finally {
      setProcessingPlanId(null)
    }
  }

  const filteredPlans = plans.filter(plan => plan.interval === billingInterval)

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-zinc-400">Loading pricing plans...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="max-w-7xl mx-auto px-6 py-20 lg:py-32">
        <div className="text-center mb-16">
          <h1 className="text-5xl lg:text-7xl font-semibold mb-6 brand-font tracking-tighter">
            Choose Your Plan
          </h1>
          <p className="text-xl text-zinc-400 font-light max-w-2xl mx-auto">
            Visual productivity for everyone. Start free, upgrade when you need more power.
          </p>
        </div>

        {/* Billing Toggle */}
        <div className="flex items-center justify-center mb-12">
          <div className="bg-zinc-900 rounded-xl p-1 inline-flex border border-zinc-800">
            <button
              onClick={() => setBillingInterval('monthly')}
              className={`px-6 py-3 rounded-lg font-medium transition-all ${
                billingInterval === 'monthly'
                  ? 'bg-white text-black'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setBillingInterval('yearly')}
              className={`px-6 py-3 rounded-lg font-medium transition-all relative ${
                billingInterval === 'yearly'
                  ? 'bg-white text-black'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Yearly
              <span className="absolute -top-2 -right-2 bg-blue-200 text-black text-xs px-2 py-0.5 rounded-full font-semibold">
                Save 20%
              </span>
            </button>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {filteredPlans.map((plan) => {
            const isFree = plan.price === 0
            const isPopular = plan.slug === 'pro' || plan.slug === 'pro-yearly'
            const isProcessing = processingPlanId === plan._id

            return (
              <div
                key={plan._id}
                className={`relative bg-zinc-900 rounded-3xl p-8 border ${
                  isPopular
                    ? 'border-blue-200 shadow-lg shadow-blue-200/10'
                    : 'border-zinc-800'
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                    <span className="bg-blue-200 text-black px-4 py-1 rounded-full text-sm font-semibold">
                      Most Popular
                    </span>
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-2xl font-semibold brand-font mb-2">
                    {plan.name}
                  </h3>
                  <p className="text-zinc-400 text-sm font-light">
                    {plan.description}
                  </p>
                </div>

                <div className="mb-8">
                  <div className="flex items-baseline gap-2">
                    <span className="text-5xl font-semibold brand-font">
                      {plan.price === 0 ? 'Free' : `₦${(plan.price / 1000).toFixed(0)}k`}
                    </span>
                    {!isFree && (
                      <span className="text-zinc-400 font-light">
                        /{plan.interval === 'yearly' ? 'year' : 'month'}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleSelectPlan(plan._id)}
                  disabled={isProcessing || isFree}
                  className={`w-full py-4 rounded-xl font-medium transition-all mb-8 ${
                    isPopular
                      ? 'bg-white text-black hover:bg-zinc-100'
                      : isFree
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      : 'border border-zinc-700 text-white hover:bg-zinc-800'
                  }`}
                >
                  {isProcessing
                    ? 'Processing...'
                    : isFree
                    ? 'Current Plan'
                    : 'Get Started'}
                </button>

                <div className="space-y-3">
                  {plan.features.map((feature, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <Check className="w-5 h-5 text-blue-200 flex-shrink-0 mt-0.5" />
                      <span className="text-zinc-300 font-light text-sm">
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* FAQ */}
        <div className="mt-20 max-w-3xl mx-auto">
          <h2 className="text-3xl font-semibold brand-font text-center mb-12">
            Frequently Asked Questions
          </h2>
          <div className="space-y-6">
            <div className="border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-semibold mb-2">Can I change plans later?</h3>
              <p className="text-zinc-400 font-light text-sm">
                Yes! You can upgrade or downgrade your plan at any time. Changes take effect immediately.
              </p>
            </div>
            <div className="border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-semibold mb-2">What payment methods do you accept?</h3>
              <p className="text-zinc-400 font-light text-sm">
                We accept all major payment methods through Paystack: cards, bank transfers, USSD, and mobile money.
              </p>
            </div>
            <div className="border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-semibold mb-2">Is there a free trial?</h3>
              <p className="text-zinc-400 font-light text-sm">
                Our Free plan is always available with no time limit. Upgrade when you need more features.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
