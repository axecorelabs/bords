import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/api-helpers'
import { getActiveSubscription, getUserPlan, getSubscriptionStatus } from '@/lib/subscription'

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser()
    
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = user.id

    // Get subscription status
    const status = await getSubscriptionStatus(userId)
    
    // Get current plan
    const plan = await getUserPlan(userId)
    
    // Get active subscription details
    const subscription = await getActiveSubscription(userId)

    return NextResponse.json({
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
          hasSubscription: status.hasSubscription,
          daysRemaining: status.daysRemaining,
          isExpiringSoon: status.isExpiringSoon,
        },
      },
    })
  } catch (error: any) {
    console.error('Get subscription status error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get subscription status' },
      { status: 500 }
    )
  }
}
