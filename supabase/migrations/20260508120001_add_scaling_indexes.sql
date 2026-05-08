-- Additional indexes for high-frequency filters and sort patterns

CREATE INDEX IF NOT EXISTS idx_bord_members_user_bord
  ON bord_members(user_id, bord_id);

CREATE INDEX IF NOT EXISTS idx_task_assigned_to_is_deleted
  ON task_assignments(assigned_to, is_deleted);

CREATE INDEX IF NOT EXISTS idx_conv_reads_user_last_read_at
  ON conversation_reads(user_id, last_read_at DESC);
