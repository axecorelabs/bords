-- Enable RLS on ALL tables and create access policies.
-- Service role key (supabaseAdmin) bypasses all policies.

-- ============================================================
-- ENABLE RLS
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE bords ENABLE ROW LEVEL SECURITY;
ALTER TABLE bord_access_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE yjs_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE bord_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE friends ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE publish_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE unpublished_change_tracker ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE sent_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE board_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROFILES
-- ============================================================
-- Anyone authenticated can read profiles (for name/avatar lookup)
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT USING (true);

-- Users can only update their own profile
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE USING (auth.uid() = id);

-- Profile insert is handled by the handle_new_user trigger (service role)
-- No direct insert policy needed for regular users.

-- ============================================================
-- WORKSPACES
-- ============================================================
CREATE POLICY "workspaces_select_own" ON workspaces
  FOR SELECT USING (owner_id = auth.uid());

CREATE POLICY "workspaces_insert_own" ON workspaces
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "workspaces_update_own" ON workspaces
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "workspaces_delete_own" ON workspaces
  FOR DELETE USING (owner_id = auth.uid());

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
-- Owner or employees can see the org
CREATE POLICY "organizations_select" ON organizations
  FOR SELECT USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM employee_memberships em
      WHERE em.organization_id = organizations.id AND em.user_id = auth.uid()
    )
  );

CREATE POLICY "organizations_insert" ON organizations
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "organizations_update" ON organizations
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "organizations_delete" ON organizations
  FOR DELETE USING (owner_id = auth.uid());

-- ============================================================
-- EMPLOYEE MEMBERSHIPS
-- ============================================================
-- Org owner or the employee themselves can view
CREATE POLICY "employee_memberships_select" ON employee_memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = employee_memberships.organization_id AND o.owner_id = auth.uid()
    )
  );

-- Only org owner can insert/delete memberships
CREATE POLICY "employee_memberships_insert" ON employee_memberships
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = employee_memberships.organization_id AND o.owner_id = auth.uid()
    )
  );

CREATE POLICY "employee_memberships_delete" ON employee_memberships
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = employee_memberships.organization_id AND o.owner_id = auth.uid()
    )
  );

-- ============================================================
-- PLANS (public read-only)
-- ============================================================
CREATE POLICY "plans_select_public" ON plans
  FOR SELECT USING (true);

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================
CREATE POLICY "subscriptions_select_own" ON subscriptions
  FOR SELECT USING (user_id = auth.uid());

-- Insert/update handled via service role (Paystack webhooks)

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE POLICY "payments_select_own" ON payments
  FOR SELECT USING (user_id = auth.uid());

-- Insert/update handled via service role (Paystack webhooks)

-- ============================================================
-- SUBSCRIPTION HISTORY
-- ============================================================
CREATE POLICY "subscription_history_select_own" ON subscription_history
  FOR SELECT USING (user_id = auth.uid());

-- ============================================================
-- BORDS
-- ============================================================
-- Owner or users in the access list can view
CREATE POLICY "bords_select" ON bords
  FOR SELECT USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM bord_access_list bal
      WHERE bal.bord_id = bords.id AND bal.user_id = auth.uid()
    )
    OR (
      context_type = 'organization' AND EXISTS (
        SELECT 1 FROM employee_memberships em
        WHERE em.organization_id = bords.organization_id AND em.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "bords_insert" ON bords
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "bords_update" ON bords
  FOR UPDATE USING (owner_id = auth.uid());

CREATE POLICY "bords_delete" ON bords
  FOR DELETE USING (owner_id = auth.uid());

-- ============================================================
-- BORD ACCESS LIST
-- ============================================================
CREATE POLICY "bord_access_list_select" ON bord_access_list
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_access_list.bord_id AND b.owner_id = auth.uid()
    )
  );

-- Only bord owner can manage access list
CREATE POLICY "bord_access_list_insert" ON bord_access_list
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_access_list.bord_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "bord_access_list_update" ON bord_access_list
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_access_list.bord_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "bord_access_list_delete" ON bord_access_list
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_access_list.bord_id AND b.owner_id = auth.uid()
    )
  );

-- ============================================================
-- BOARD DOCUMENTS
-- ============================================================
CREATE POLICY "board_documents_select" ON board_documents
  FOR SELECT USING (
    owner_id = auth.uid()
    OR visibility = 'public'
    OR EXISTS (
      SELECT 1 FROM bord_access_list bal
      JOIN bords b ON bal.bord_id = b.id
      WHERE b.local_board_id = board_documents.local_board_id
        AND b.owner_id = board_documents.owner_id
        AND bal.user_id = auth.uid()
    )
  );

CREATE POLICY "board_documents_insert" ON board_documents
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "board_documents_update" ON board_documents
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM bord_access_list bal
      JOIN bords b ON bal.bord_id = b.id
      WHERE b.local_board_id = board_documents.local_board_id
        AND b.owner_id = board_documents.owner_id
        AND bal.user_id = auth.uid()
        AND bal.permission = 'edit'
    )
  );

CREATE POLICY "board_documents_delete" ON board_documents
  FOR DELETE USING (owner_id = auth.uid());

-- ============================================================
-- YJS DOCUMENTS
-- ============================================================
-- Yjs docs are accessed by the collab server via service role.
-- No user-facing RLS policies needed — all access through admin client.
-- Add a restrictive default: deny all user access.
CREATE POLICY "yjs_documents_deny_all" ON yjs_documents
  FOR ALL USING (false);

-- ============================================================
-- BORD MEMBERS
-- ============================================================
CREATE POLICY "bord_members_select" ON bord_members
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_members.bord_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "bord_members_insert" ON bord_members
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_members.bord_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "bord_members_update" ON bord_members
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_members.bord_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "bord_members_delete" ON bord_members
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_members.bord_id AND b.owner_id = auth.uid()
    )
  );

-- ============================================================
-- FRIENDS
-- ============================================================
CREATE POLICY "friends_select" ON friends
  FOR SELECT USING (
    owner_id = auth.uid() OR friend_user_id = auth.uid()
  );

CREATE POLICY "friends_insert" ON friends
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "friends_update" ON friends
  FOR UPDATE USING (
    owner_id = auth.uid() OR friend_user_id = auth.uid()
  );

CREATE POLICY "friends_delete" ON friends
  FOR DELETE USING (owner_id = auth.uid());

-- ============================================================
-- INVITATIONS
-- ============================================================
-- Org owner or invitee can view
CREATE POLICY "invitations_select" ON invitations
  FOR SELECT USING (
    invited_by = auth.uid()
    OR email = (SELECT email FROM profiles WHERE id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = invitations.organization_id AND o.owner_id = auth.uid()
    )
  );

CREATE POLICY "invitations_insert" ON invitations
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = invitations.organization_id AND o.owner_id = auth.uid()
    )
  );

-- Update by org owner (e.g. expire) or by invitee (accept)
CREATE POLICY "invitations_update" ON invitations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = invitations.organization_id AND o.owner_id = auth.uid()
    )
    OR email = (SELECT email FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "invitations_delete" ON invitations
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = invitations.organization_id AND o.owner_id = auth.uid()
    )
  );

-- ============================================================
-- TASK ASSIGNMENTS
-- ============================================================
-- Assigned user or assigner can view
CREATE POLICY "task_assignments_select" ON task_assignments
  FOR SELECT USING (
    assigned_to = auth.uid()
    OR assigned_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM bords b WHERE b.id = task_assignments.bord_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "task_assignments_insert" ON task_assignments
  FOR INSERT WITH CHECK (assigned_by = auth.uid());

-- Assigner can update (reassign, etc.), assignee can update (complete, add execution note)
CREATE POLICY "task_assignments_update" ON task_assignments
  FOR UPDATE USING (
    assigned_by = auth.uid() OR assigned_to = auth.uid()
  );

CREATE POLICY "task_assignments_delete" ON task_assignments
  FOR DELETE USING (assigned_by = auth.uid());

-- ============================================================
-- PUBLISH SNAPSHOTS
-- ============================================================
CREATE POLICY "publish_snapshots_select" ON publish_snapshots
  FOR SELECT USING (
    published_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM bords b WHERE b.id = publish_snapshots.bord_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "publish_snapshots_insert" ON publish_snapshots
  FOR INSERT WITH CHECK (published_by = auth.uid());

-- ============================================================
-- UNPUBLISHED CHANGE TRACKER
-- ============================================================
CREATE POLICY "unpublished_change_tracker_select" ON unpublished_change_tracker
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM bords b WHERE b.id = unpublished_change_tracker.bord_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "unpublished_change_tracker_all" ON unpublished_change_tracker
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM bords b WHERE b.id = unpublished_change_tracker.bord_id AND b.owner_id = auth.uid()
    )
  );

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE POLICY "notifications_all_own" ON notifications
  FOR ALL USING (user_id = auth.uid());

-- ============================================================
-- SENT REMINDERS
-- ============================================================
-- Managed by service role (cron/API). Deny direct user access.
CREATE POLICY "sent_reminders_deny_all" ON sent_reminders
  FOR ALL USING (false);

-- ============================================================
-- BOARD METADATA
-- ============================================================
-- Managed by collab server (service role). Deny direct user access.
CREATE POLICY "board_metadata_deny_all" ON board_metadata
  FOR ALL USING (false);

-- ============================================================
-- CALLS
-- ============================================================
-- Anyone authenticated can see active calls for boards they have access to.
-- For simplicity, allow read for all authenticated users (call membership checked in app).
CREATE POLICY "calls_select" ON calls
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Call creation/update handled by collab server (service role).
CREATE POLICY "calls_deny_write" ON calls
  FOR INSERT WITH CHECK (false);

CREATE POLICY "calls_deny_update" ON calls
  FOR UPDATE USING (false);

CREATE POLICY "calls_deny_delete" ON calls
  FOR DELETE USING (false);
