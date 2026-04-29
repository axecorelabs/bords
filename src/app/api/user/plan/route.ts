import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { getUserPlan, getActiveSubscription } from '@/lib/subscription'
import { cacheGet, cacheSet, CacheKeys, CacheTTL } from '@/lib/cache'

export async function GET() {
  try {
    const user = await getAuthUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check cache first
    const cached = await cacheGet(CacheKeys.userPlan(user.id))
    if (cached) return NextResponse.json(cached)

    const plan = await getUserPlan(user.id)
    const subscription = await getActiveSubscription(user.id)

    let body
    if (plan && plan.slug !== 'free') {
      body = {
        name: plan.name,
        slug: plan.slug,
        maxBoards: plan.max_boards,
        maxTasksPerBoard: plan.max_tasks_per_board,
        maxCollaborators: plan.max_collaborators,
        subscriptionStatus: subscription?.status || 'active',
        endDate: subscription?.end_date || null,
      }
    } else {
      body = {
        name: plan?.name || 'Free',
        slug: plan?.slug || 'free',
        maxBoards: plan?.max_boards ?? 3,
        maxTasksPerBoard: plan?.max_tasks_per_board ?? 50,
        maxCollaborators: plan?.max_collaborators ?? 0,
        subscriptionStatus: 'none',
      }
    }

    await cacheSet(CacheKeys.userPlan(user.id), body, CacheTTL.USER_PLAN)
    return NextResponse.json(body)
  } catch (error) {
    console.error('Error fetching user plan:', error)
    return NextResponse.json(
      { error: 'Failed to fetch user plan' },
      { status: 500 }
    )
  }
}
