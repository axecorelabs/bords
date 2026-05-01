-- Enable Supabase Realtime for the messages table
-- This is required for postgres_changes subscriptions to fire.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  END IF;
END$$;

-- REPLICA IDENTITY FULL ensures UPDATE events include the full old+new row
ALTER TABLE messages REPLICA IDENTITY FULL;
