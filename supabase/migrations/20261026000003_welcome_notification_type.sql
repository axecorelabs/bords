-- 'welcome' was inserted by the signup/OAuth flows but never allowed by the check
-- constraint, so the insert has always failed silently (0 rows ever). Allow it.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'task_assigned', 'task_unassigned', 'task_reassigned', 'task_completed', 'task_updated',
    'org_invitation', 'invitation_accepted',
    'friend_request', 'friend_accepted', 'friend_removed',
    'reminder_due', 'reminder_overdue',
    'group_chat_added',
    'welcome'
  ));
