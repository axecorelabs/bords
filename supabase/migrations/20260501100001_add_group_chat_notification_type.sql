-- Add group_chat_added to the notifications type check constraint
ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'task_assigned', 'task_unassigned', 'task_reassigned', 'task_completed', 'task_updated',
    'org_invitation', 'invitation_accepted',
    'friend_request', 'friend_accepted', 'friend_removed',
    'reminder_due', 'reminder_overdue',
    'group_chat_added'
  ));
