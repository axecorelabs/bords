import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Send a notification to all org owners and admins (excluding the actor).
 * Fire-and-forget — errors are logged but don't block the caller.
 */
export async function notifyOrgOwnersAndAdmins(
  supabase: SupabaseClient,
  organizationId: string,
  actorUserId: string,
  type: string,
  title: string,
  actionDescription: string,
  extraMetadata: Record<string, any> = {}
): Promise<void> {
  try {
    // Get org details + owner
    const { data: org } = await supabase
      .from('organizations')
      .select('owner_id, name')
      .eq('id', organizationId)
      .maybeSingle()
    if (!org) return

    // Get admins
    const { data: admins } = await supabase
      .from('employee_memberships')
      .select('user_id')
      .eq('organization_id', organizationId)
      .eq('role', 'admin')

    // Collect unique user IDs (owner + admins), excluding the actor
    const recipientIds = new Set<string>()
    if (org.owner_id !== actorUserId) recipientIds.add(org.owner_id)
    for (const a of admins || []) {
      if (a.user_id !== actorUserId) recipientIds.add(a.user_id)
    }
    if (recipientIds.size === 0) return

    // Get actor name for the message
    const { data: actor } = await supabase
      .from('profiles')
      .select('first_name, last_name')
      .eq('id', actorUserId)
      .maybeSingle()
    const actorName = actor
      ? `${actor.first_name || ''} ${actor.last_name || ''}`.trim() || 'A member'
      : 'A member'

    const notifications = Array.from(recipientIds).map(userId => ({
      user_id: userId,
      type,
      title,
      message: `${actorName} ${actionDescription} in ${org.name}`,
      metadata: {
        organizationId,
        organizationName: org.name,
        actorId: actorUserId,
        actorName,
        ...extraMetadata,
      },
      is_read: false,
    }))

    await supabase.from('notifications').insert(notifications)
  } catch (err) {
    console.error('[org-notifications] Failed to send notifications:', err)
  }
}
