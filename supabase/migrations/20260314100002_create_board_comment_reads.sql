-- Per-user read tracking for board comments.
-- Stores the timestamp when a user last viewed a board's comments.
CREATE TABLE board_comment_reads (
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  board_id     TEXT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, board_id)
);

-- Enable RLS
ALTER TABLE board_comment_reads ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own read-state
CREATE POLICY "board_comment_reads_select" ON board_comment_reads
  FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "board_comment_reads_upsert" ON board_comment_reads
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "board_comment_reads_update" ON board_comment_reads
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
