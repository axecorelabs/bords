-- Add metadata JSONB to messages for AI and future extensibility
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Optional index for metadata queries (safe to keep broad at this stage)
CREATE INDEX IF NOT EXISTS idx_messages_metadata_gin
  ON messages USING GIN (metadata);
