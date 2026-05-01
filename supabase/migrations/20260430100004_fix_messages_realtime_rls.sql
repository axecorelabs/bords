-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: Supabase Realtime postgres_changes runs as service role (auth.uid()=NULL),
-- so subquery-based RLS policies silently block all broadcast events.
--
-- Pattern taken from board_comments: keep the subquery policy for API SELECT,
-- add a separate USING (true) policy so Realtime can broadcast to subscribers.
-- Actual per-user row filtering is already enforced by the subscriber filter
-- (conversation_id=eq.X) and the API-layer RLS on INSERT/UPDATE/DELETE.
-- ─────────────────────────────────────────────────────────────────────────────

-- messages
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'messages' AND policyname = 'messages_realtime_select'
  ) THEN
    CREATE POLICY "messages_realtime_select" ON messages
      FOR SELECT TO authenticated USING (true);
  END IF;
END$$;

-- message_reactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'message_reactions' AND policyname = 'reactions_realtime_select'
  ) THEN
    CREATE POLICY "reactions_realtime_select" ON message_reactions
      FOR SELECT TO authenticated USING (true);
  END IF;
END$$;

-- message_attachments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'message_attachments' AND policyname = 'attachments_realtime_select'
  ) THEN
    CREATE POLICY "attachments_realtime_select" ON message_attachments
      FOR SELECT TO authenticated USING (true);
  END IF;
END$$;
