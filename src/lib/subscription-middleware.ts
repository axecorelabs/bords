import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserPlan, hasFeatureAccess } from '@/lib/subscription'

export interface SubscriptionMiddlewareConfig {
  requiredPlan?: string
  requiredFeature?: string
  minBoards?: number
  minTasks?: number
}

/**
 * Middleware to check subscription and feature access
 * Use this in API routes that require subscription
 */
export async function withSubscription(
  request: NextRequest,
  config: SubscriptionMiddlewareConfig = {}
) {
  try {
    // Get authenticated user from Supabase
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    
    if (error || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const userId = user.id

    // Get user's current plan
    const plan = await getUserPlan(userId)
    
    if (!plan) {
      return NextResponse.json(
        { error: 'No active plan found' },
        { status: 403 }
      )
    }

    // Check required plan
    if (config.requiredPlan && plan.slug !== config.requiredPlan) {
      return NextResponse.json(
        { 
          error: 'Upgrade required',
          message: `This feature requires the ${config.requiredPlan} plan`,
          currentPlan: plan.slug,
          requiredPlan: config.requiredPlan,
        },
        { status: 403 }
      )
    }

    // Check required feature
    if (config.requiredFeature) {
      const hasAccess = await hasFeatureAccess(userId, config.requiredFeature)
      
      if (!hasAccess) {
        return NextResponse.json(
          { 
            error: 'Feature not available',
            message: `This feature is not included in your ${plan.name} plan`,
            feature: config.requiredFeature,
          },
          { status: 403 }
        )
      }
    }

    // Return user info and plan for use in the route
    return {
      userId,
      plan,
      hasAccess: true,
    }
  } catch (error: any) {
    console.error('Subscription middleware error:', error)
    return NextResponse.json(
      { error: 'Failed to verify subscription' },
      { status: 500 }
    )
  }
}

/**
 * Helper to check board limits
 */
export async function checkBoardLimit(userId: string, currentCount: number) {
  const plan = await getUserPlan(userId)
  
  if (!plan) {
    return {
      allowed: false,
      message: 'No active plan found',
    }
  }

  // -1 means unlimited
  if (plan.max_boards === -1) {
    return {
      allowed: true,
      limit: -1,
      current: currentCount,
    }
  }

  if (currentCount >= plan.max_boards) {
    return {
      allowed: false,
      limit: plan.max_boards,
      current: currentCount,
      message: `You've reached the maximum of ${plan.max_boards} boards for your ${plan.name} plan`,
      upgradeRequired: true,
    }
  }

  return {
    allowed: true,
    limit: plan.max_boards,
    current: currentCount,
    remaining: plan.max_boards - currentCount,
  }
}

/**
 * Helper to check task limits
 */
export async function checkTaskLimit(userId: string, currentCount: number) {
  const plan = await getUserPlan(userId)
  
  if (!plan) {
    return {
      allowed: false,
      message: 'No active plan found',
    }
  }

  // -1 means unlimited
  if (plan.max_tasks_per_board === -1) {
    return {
      allowed: true,
      limit: -1,
      current: currentCount,
    }
  }

  if (currentCount >= plan.max_tasks_per_board) {
    return {
      allowed: false,
      limit: plan.max_tasks_per_board,
      current: currentCount,
      message: `You've reached the maximum of ${plan.max_tasks_per_board} tasks per board for your ${plan.name} plan`,
      upgradeRequired: true,
    }
  }

  return {
    allowed: true,
    limit: plan.max_tasks_per_board,
    current: currentCount,
    remaining: plan.max_tasks_per_board - currentCount,
  }
}

/**
 * Helper to check collaborator limits
 */
export async function checkCollaboratorLimit(userId: string, currentCount: number) {
  const plan = await getUserPlan(userId)
  
  if (!plan) {
    return {
      allowed: false,
      message: 'No active plan found',
    }
  }

  // -1 means unlimited
  if (plan.max_collaborators === -1) {
    return {
      allowed: true,
      limit: -1,
      current: currentCount,
    }
  }

  if (currentCount >= plan.max_collaborators) {
    return {
      allowed: false,
      limit: plan.max_collaborators,
      current: currentCount,
      message: `You've reached the maximum of ${plan.max_collaborators} collaborators for your ${plan.name} plan`,
      upgradeRequired: true,
    }
  }

  return {
    allowed: true,
    limit: plan.max_collaborators,
    current: currentCount,
    remaining: plan.max_collaborators - currentCount,
  }
}
