-- Add tasks JSONB column to board_metadata
-- Stores all actionable items (checklist items, kanban tasks, reminder items)
-- extracted from Y.Doc by the MetadataExtractor on每save.
ALTER TABLE board_metadata
  ADD COLUMN IF NOT EXISTS tasks JSONB DEFAULT '[]'::jsonb;
