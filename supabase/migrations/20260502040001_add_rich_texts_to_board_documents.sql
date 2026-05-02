-- Add rich text document support to board_documents payloads
ALTER TABLE board_documents
ADD COLUMN IF NOT EXISTS rich_texts JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Ensure PostgREST sees the new column quickly.
NOTIFY pgrst, 'reload schema';
