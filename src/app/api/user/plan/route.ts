import { NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { getUserPlan, getActiveSubscription } from '@/lib/subscription'

export async function GET() {
  try {
    const user = await getAuthUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const plan = await getUserPlan(user.id)
    const subscription = await getActiveSubscription(user.id)

    if (plan && plan.slug !== 'free') {
      return NextResponse.json({
        name: plan.name,
        slug: plan.slug,
        maxBoards: plan.max_boards,
        maxTasksPerBoard: plan.max_tasks_per_board,
        maxCollaborators: plan.max_collaborators,
        subscriptionStatus: subscription?.status || 'active',
        endDate: subscription?.end_date || null,
      })
    }

    // Default to free plan
    return NextResponse.json({
      name: plan?.name || 'Free',
      slug: plan?.slug || 'free',
      maxBoards: plan?.max_boards ?? 3,
      maxTasksPerBoard: plan?.max_tasks_per_board ?? 50,
      maxCollaborators: plan?.max_collaborators ?? 0,
      subscriptionStatus: 'none',
    })
  } catch (error) {
    console.error('Error fetching user plan:', error)
    return NextResponse.json(
      { error: 'Failed to fetch user plan' },
      { status: 500 }
    )
  }
}
