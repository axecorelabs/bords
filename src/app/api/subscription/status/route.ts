import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { getActiveSubscription, getUserPlan } from '@/lib/subscription'
import { apiLimiter, checkRateLimit } from '@/lib/rate-limit'
import { cacheGet, cacheSet, CacheKeys, CacheTTL } from '@/lib/cache'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser()

    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const rateLimitRes = await checkRateLimit(apiLimiter, user.id)
    if (rateLimitRes) return rateLimitRes

    const cacheKey = CacheKeys.subStatus(user.id)
    const cached = await cacheGet(cacheKey)
    if (cached) return NextResponse.json(cached)

    // Single DB call; getUserPlan and getSubscriptionStatus both call
    // getActiveSubscription internally — fetch once and derive everything.
    const subscription = await getActiveSubscription(user.id)
    const plan = subscription?.plan ?? await getUserPlan(user.id)

    const now = new Date()
    const endDate = subscription?.end_date ? new Date(subscription.end_date) : null
    const daysRemaining = endDate
      ? Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : 0

    const body = {
      success: true,
      data: {
        subscription: subscription ? {
          id: subscription.id,
          status: subscription.status,
          startDate: subscription.start_date,
          endDate: subscription.end_date,
        } : null,
        plan: plan ? {
          id: plan.id,
          name: plan.name,
          slug: plan.slug,
          price: plan.price,
          currency: plan.currency,
          interval: plan.interval,
          features: plan.features,
          maxBoards: plan.max_boards,
          maxTasksPerBoard: plan.max_tasks_per_board,
          maxCollaborators: plan.max_collaborators,
        } : null,
        status: {
          hasSubscription: !!subscription,
          daysRemaining,
          isExpiringSoon: daysRemaining > 0 && daysRemaining <= 3,
        },
      },
    }

    await cacheSet(cacheKey, body, CacheTTL.SUB_STATUS)
    return NextResponse.json(body)
  } catch (error: any) {
    console.error('Get subscription status error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get subscription status' },
      { status: 500 }
    )
  }
}
