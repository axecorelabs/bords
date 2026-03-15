-- Add missing columns needed by the board sync API routes.
-- These fields exist in the MongoDB BoardDocument model but were not in the initial schema.

-- Sync metadata
ALTER TABLE board_documents ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE board_documents ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE board_documents ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE board_documents ADD COLUMN IF NOT EXISTS item_ids JSONB NOT NULL DEFAULT '{}';

-- Background fields (match MongoDB schema; separate from the generic background_type/value)
ALTER TABLE board_documents ADD COLUMN IF NOT EXISTS background_image TEXT;
ALTER TABLE board_documents ADD COLUMN IF NOT EXISTS background_color TEXT;
ALTER TABLE board_documents ADD COLUMN IF NOT EXISTS background_overlay BOOLEAN DEFAULT false;
ALTER TABLE board_documents ADD COLUMN IF NOT EXISTS background_overlay_color TEXT;
ALTER TABLE board_documents ADD COLUMN IF NOT EXISTS background_blur_level REAL;

-- Index on content_hash for fast change detection
CREATE INDEX IF NOT EXISTS idx_board_docs_content_hash ON board_documents(local_board_id, content_hash);

-- Update the RLS select policy to also allow access via shared_with JSONB
DROP POLICY IF EXISTS "board_documents_select" ON board_documents;
CREATE POLICY "board_documents_select" ON board_documents
  FOR SELECT USING (
    owner_id = auth.uid()
    OR visibility = 'public'
    OR shared_with @> jsonb_build_array(jsonb_build_object('userId', auth.uid()::text))
    OR EXISTS (
      SELECT 1 FROM bord_access_list bal
      JOIN bords b ON bal.bord_id = b.id
      WHERE b.local_board_id = board_documents.local_board_id
        AND b.owner_id = board_documents.owner_id
        AND bal.user_id = auth.uid()
    )
  );

-- Update the RLS update policy to also allow shared_with editors
DROP POLICY IF EXISTS "board_documents_update" ON board_documents;
CREATE POLICY "board_documents_update" ON board_documents
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(shared_with) elem
      WHERE elem->>'userId' = auth.uid()::text
        AND elem->>'permission' = 'edit'
    )
    OR EXISTS (
      SELECT 1 FROM bord_access_list bal
      JOIN bords b ON bal.bord_id = b.id
      WHERE b.local_board_id = board_documents.local_board_id
        AND b.owner_id = board_documents.owner_id
        AND bal.user_id = auth.uid()
        AND bal.permission = 'edit'
    )
  );

-- GIN index on shared_with for fast JSONB containment queries
CREATE INDEX IF NOT EXISTS idx_board_docs_shared_with ON board_documents USING GIN (shared_with);
