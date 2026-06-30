-- Audit trail for task assignment lifecycle events
CREATE TABLE task_activity_log (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_assignment_id   UUID NOT NULL REFERENCES task_assignments(id) ON DELETE CASCADE,
  organization_id      UUID REFERENCES organizations(id) ON DELETE SET NULL,
  actor_id             UUID NOT NULL,
  actor_name           TEXT NOT NULL,
  action               TEXT NOT NULL CHECK (action IN ('assigned', 'edited', 'completed', 'reopened', 'deleted')),
  changes              JSONB DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_activity_org  ON task_activity_log(organization_id, created_at DESC);
CREATE INDEX idx_task_activity_task ON task_activity_log(task_assignment_id, created_at DESC);
