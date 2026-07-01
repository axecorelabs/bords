-- Expand allowed status values to support kanban execution states
-- The original constraint only had draft/assigned/completed, but checklist
-- auto-transition needs in_progress, and the execution view uses backlog/review too.
ALTER TABLE task_assignments
  DROP CONSTRAINT IF EXISTS task_assignments_status_check;

ALTER TABLE task_assignments
  ADD CONSTRAINT task_assignments_status_check
  CHECK (status IN ('draft', 'assigned', 'backlog', 'pending', 'in_progress', 'review', 'completed'));
