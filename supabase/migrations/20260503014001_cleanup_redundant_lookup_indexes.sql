-- Cleanup redundant indexes added in 20260503013001_add_ai_latency_lookup_indexes.sql
--
-- These are redundant because equivalent indexes already exist via UNIQUE
-- constraints or existing composite indexes:
-- - conversation_members(conversation_id, user_id)  -> UNIQUE(conversation_id, user_id)
-- - employee_memberships(user_id, organization_id)  -> UNIQUE(user_id, organization_id)
-- - board_documents(local_board_id)                 -> idx_board_docs_content_hash(local_board_id, content_hash)

DROP INDEX IF EXISTS idx_conversation_members_conv_user;
DROP INDEX IF EXISTS idx_employee_memberships_user_org;
DROP INDEX IF EXISTS idx_board_documents_local_board_id;
