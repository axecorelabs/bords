-- Add checklist description support to task_assignments
ALTER TABLE task_assignments
  ADD COLUMN IF NOT EXISTS description_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS checklist_items   JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE task_assignments
  ADD CONSTRAINT task_assignments_description_type_check
  CHECK (description_type IN ('text', 'checklist'));
