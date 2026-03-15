-- Task assignments, publish snapshots, unpublished change tracker

-- Task assignments (assigned from notes / checklists / kanban / reminders)
CREATE TABLE task_assignments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bord_id           UUID REFERENCES bords(id) ON DELETE SET NULL,
  workspace_id      UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  organization_id   UUID REFERENCES organizations(id) ON DELETE SET NULL,
  context_type      TEXT NOT NULL DEFAULT 'organization' CHECK (context_type IN ('personal', 'organization')),
  source_type       TEXT NOT NULL CHECK (source_type IN ('note', 'checklist_item', 'kanban_task', 'reminder_item')),
  source_id         TEXT NOT NULL,
  content           TEXT NOT NULL,
  assigned_to       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  priority          TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
  due_date          TIMESTAMPTZ,
  execution_note    TEXT,
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'assigned', 'completed')),
  published_at      TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  is_deleted        BOOLEAN NOT NULL DEFAULT FALSE,
  column_id         TEXT,
  column_title      TEXT,
  available_columns JSONB DEFAULT '[]'::jsonb,
  employee_updates  JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER task_assignments_updated_at
  BEFORE UPDATE ON task_assignments
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

CREATE INDEX idx_task_bord_status ON task_assignments(bord_id, status);
CREATE INDEX idx_task_assigned_to ON task_assignments(assigned_to, status);
CREATE INDEX idx_task_source ON task_assignments(bord_id, source_type, source_id);
CREATE INDEX idx_task_context ON task_assignments(context_type, assigned_to, status);
CREATE INDEX idx_task_workspace ON task_assignments(workspace_id, context_type);

-- Publish snapshots (versioned publish events per bord)
CREATE TABLE publish_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bord_id               UUID NOT NULL REFERENCES bords(id) ON DELETE CASCADE,
  version_number        INTEGER NOT NULL,
  published_by          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  new_assignments       INTEGER NOT NULL DEFAULT 0,
  reassignments         INTEGER NOT NULL DEFAULT 0,
  unassignments         INTEGER NOT NULL DEFAULT 0,
  published_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_publish_bord_version ON publish_snapshots(bord_id, version_number DESC);

-- Unpublished change tracker (dirty flag per bord)
CREATE TABLE unpublished_change_tracker (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bord_id         UUID NOT NULL UNIQUE REFERENCES bords(id) ON DELETE CASCADE,
  change_count    INTEGER NOT NULL DEFAULT 0,
  last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
