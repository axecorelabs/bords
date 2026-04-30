-- Add visibility column to bords table.
-- 'private'  = only owner + explicit bord_access_list entries can see the board (default)
-- 'org'      = all members of the board's organization can see the board

ALTER TABLE bords
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'org'));

-- Index for the common query: org boards visible to all org members
CREATE INDEX idx_bords_visibility ON bords(organization_id, visibility)
  WHERE visibility = 'org';
