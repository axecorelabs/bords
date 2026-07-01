-- Expand allowed status values to support kanban execution states
-- The original constraint only had draft/assigned/completed, but checklist
-- auto-transition needs in_progress, and the execution view uses backlog/review too.
ALTER TABLE task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_status_check;

ALTER TABLE task_assignments
  ADD CONSTRAINT task_assignments_status_check
  CHECK (status IN ('draft', 'assigned', 'backlog', 'pending', 'in_progress', 'review', 'completed'));

-- Add skip_review toggle set by the assigner.
-- When true: completing all checklist items auto-moves the task to completed,
--            and the assignee may also drag the card to completed manually.
-- When false (default): all-complete → review; assignee cannot drag to completed.
ALTER TABLE task_assignments
  ADD COLUMN IF NOT EXISTS skip_review BOOLEAN NOT NULL DEFAULT false;
