-- Speed up hot lookup paths used by the AI respond route and board access checks.

CREATE INDEX IF NOT EXISTS idx_conversation_members_conv_user
  ON conversation_members (conversation_id, user_id);

CREATE INDEX IF NOT EXISTS idx_messages_conv_not_deleted_created
  ON messages (conversation_id, created_at DESC)
  WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_employee_memberships_org_user
  ON employee_memberships (organization_id, user_id);

CREATE INDEX IF NOT EXISTS idx_employee_memberships_user_org
  ON employee_memberships (user_id, organization_id);

CREATE INDEX IF NOT EXISTS idx_bords_local_board_id
  ON bords (local_board_id);

CREATE INDEX IF NOT EXISTS idx_board_documents_local_board_id
  ON board_documents (local_board_id);
