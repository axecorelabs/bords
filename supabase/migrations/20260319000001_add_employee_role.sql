-- Add role column to employee_memberships: 'admin' | 'member' (default)
-- Owner role is NOT stored here — it's derived from organizations.owner_id
ALTER TABLE employee_memberships
  ADD COLUMN role TEXT NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin', 'member'));

-- Update invitations table: allow 'admin' as a sub-role for employee invitations
-- The existing 'role' column stays as-is ('employee' | 'collaborator')
-- We add a new column for the org-level role when role='employee'
ALTER TABLE invitations
  ADD COLUMN org_role TEXT DEFAULT 'member'
    CHECK (org_role IN ('admin', 'member'));

-- Update the accept_invitation function to pass org_role through
-- (The current function in 20260313230712 only does a plain insert)
-- We'll handle this in the application code instead, since the function
-- is only used for the DB trigger path and our main flow uses the API route.
