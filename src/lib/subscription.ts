import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Get active subscription for a user (with plan data joined)
 */
export async function getActiveSubscription(userId: string) {
  const { data } = await supabaseAdmin
    .from('subscriptions')
    .select('*, plan:plans(*)')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('end_date', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return data
}

/**
 * Get user's current plan (or default free plan)
 */
export async function getUserPlan(userId: string) {
  const subscription = await getActiveSubscription(userId)

  if (subscription && subscription.plan) {
    return subscription.plan
  }

  // Return free plan if no active subscription
  const { data: freePlan } = await supabaseAdmin
    .from('plans')
    .select('*')
    .eq('slug', 'free')
    .maybeSingle()

  return freePlan
}

/**
 * Check if user has access to a feature
 */
export async function hasFeatureAccess(
  userId: string,
  feature: string
): Promise<boolean> {
  const plan = await getUserPlan(userId)
  if (!plan) return false
  return plan.features.includes(feature)
}

/**
 * Check if user can create more boards
 */
export async function canCreateBoard(
  userId: string,
  currentBoardCount: number
): Promise<boolean> {
  const plan = await getUserPlan(userId)
  if (!plan) return false
  if (plan.max_boards === -1) return true
  return currentBoardCount < plan.max_boards
}

/**
 * Check if user can add more tasks to a board
 */
export async function canAddTask(
  userId: string,
  currentTaskCount: number
): Promise<boolean> {
  const plan = await getUserPlan(userId)
  if (!plan) return false
  if (plan.max_tasks_per_board === -1) return true
  return currentTaskCount < plan.max_tasks_per_board
}

/**
 * Get subscription status and days remaining
 */
export async function getSubscriptionStatus(userId: string) {
  const subscription = await getActiveSubscription(userId)

  if (!subscription) {
    return {
      hasSubscription: false,
      status: null,
      daysRemaining: 0,
      isExpiringSoon: false,
    }
  }

  const now = new Date()
  const endDate = new Date(subscription.end_date!)
  const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  return {
    hasSubscription: true,
    status: subscription.status,
    daysRemaining,
    isExpiringSoon: daysRemaining <= 3 && daysRemaining > 0,
    endDate: subscription.end_date,
  }
}
