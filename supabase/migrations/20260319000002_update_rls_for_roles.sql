-- Update RLS policies so org owners/admins can access org boards implicitly
-- (without needing explicit bord_access_list entries)

-- ── BORDS: org owners + admins can view all org boards ──
DROP POLICY IF EXISTS "bords_select" ON bords;
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
    OR (
      context_type = 'organization' AND EXISTS (
        SELECT 1 FROM organizations o
        WHERE o.id = bords.organization_id AND o.owner_id = auth.uid()
      )
    )
  );

-- Org owners + admins can update any org board
DROP POLICY IF EXISTS "bords_update" ON bords;
CREATE POLICY "bords_update" ON bords
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR (
      context_type = 'organization' AND (
        EXISTS (
          SELECT 1 FROM organizations o
          WHERE o.id = bords.organization_id AND o.owner_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM employee_memberships em
          WHERE em.organization_id = bords.organization_id
            AND em.user_id = auth.uid()
            AND em.role = 'admin'
        )
      )
    )
  );

-- Only board owner or org owner can delete boards
DROP POLICY IF EXISTS "bords_delete" ON bords;
CREATE POLICY "bords_delete" ON bords
  FOR DELETE USING (
    owner_id = auth.uid()
    OR (
      context_type = 'organization' AND EXISTS (
        SELECT 1 FROM organizations o
        WHERE o.id = bords.organization_id AND o.owner_id = auth.uid()
      )
    )
  );

-- ── BORD ACCESS LIST: org owners + admins can manage access for org boards ──
DROP POLICY IF EXISTS "bord_access_list_select" ON bord_access_list;
CREATE POLICY "bord_access_list_select" ON bord_access_list
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_access_list.bord_id AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM bords b
      JOIN organizations o ON o.id = b.organization_id
      WHERE b.id = bord_access_list.bord_id
        AND b.context_type = 'organization'
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM employee_memberships em
            WHERE em.organization_id = b.organization_id
              AND em.user_id = auth.uid()
              AND em.role = 'admin'
          )
        )
    )
  );

DROP POLICY IF EXISTS "bord_access_list_insert" ON bord_access_list;
CREATE POLICY "bord_access_list_insert" ON bord_access_list
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_access_list.bord_id AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM bords b
      JOIN organizations o ON o.id = b.organization_id
      WHERE b.id = bord_access_list.bord_id
        AND b.context_type = 'organization'
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM employee_memberships em
            WHERE em.organization_id = b.organization_id
              AND em.user_id = auth.uid()
              AND em.role = 'admin'
          )
        )
    )
  );

DROP POLICY IF EXISTS "bord_access_list_update" ON bord_access_list;
CREATE POLICY "bord_access_list_update" ON bord_access_list
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_access_list.bord_id AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM bords b
      JOIN organizations o ON o.id = b.organization_id
      WHERE b.id = bord_access_list.bord_id
        AND b.context_type = 'organization'
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM employee_memberships em
            WHERE em.organization_id = b.organization_id
              AND em.user_id = auth.uid()
              AND em.role = 'admin'
          )
        )
    )
  );

DROP POLICY IF EXISTS "bord_access_list_delete" ON bord_access_list;
CREATE POLICY "bord_access_list_delete" ON bord_access_list
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM bords b WHERE b.id = bord_access_list.bord_id AND b.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM bords b
      JOIN organizations o ON o.id = b.organization_id
      WHERE b.id = bord_access_list.bord_id
        AND b.context_type = 'organization'
        AND (
          o.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM employee_memberships em
            WHERE em.organization_id = b.organization_id
              AND em.user_id = auth.uid()
              AND em.role = 'admin'
          )
        )
    )
  );

-- ── BOARD DOCUMENTS: org owners + admins can read + edit org board documents ──
DROP POLICY IF EXISTS "board_documents_select" ON board_documents;
CREATE POLICY "board_documents_select" ON board_documents
  FOR SELECT USING (
    owner_id = auth.uid()
    OR visibility = 'public'
    OR shared_with @> jsonb_build_array(jsonb_build_object('userId', auth.uid()::text))
    OR EXISTS (
      SELECT 1 FROM bord_access_list bal
      JOIN bords b ON bal.bord_id = b.id
      WHERE b.local_board_id = board_documents.local_board_id
        AND b.owner_id = board_documents.owner_id
        AND bal.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM bords b
      WHERE b.local_board_id = board_documents.local_board_id
        AND b.owner_id = board_documents.owner_id
        AND b.context_type = 'organization'
        AND (
          EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = b.organization_id AND o.owner_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM employee_memberships em
            WHERE em.organization_id = b.organization_id
              AND em.user_id = auth.uid()
              AND em.role = 'admin'
          )
        )
    )
  );

DROP POLICY IF EXISTS "board_documents_update" ON board_documents;
CREATE POLICY "board_documents_update" ON board_documents
  FOR UPDATE USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM jsonb_array_elements(shared_with) elem
      WHERE elem->>'userId' = auth.uid()::text
        AND elem->>'permission' = 'edit'
    )
    OR EXISTS (
      SELECT 1 FROM bord_access_list bal
      JOIN bords b ON bal.bord_id = b.id
      WHERE b.local_board_id = board_documents.local_board_id
        AND b.owner_id = board_documents.owner_id
        AND bal.user_id = auth.uid()
        AND bal.permission = 'edit'
    )
    OR EXISTS (
      SELECT 1 FROM bords b
      WHERE b.local_board_id = board_documents.local_board_id
        AND b.owner_id = board_documents.owner_id
        AND b.context_type = 'organization'
        AND (
          EXISTS (
            SELECT 1 FROM organizations o
            WHERE o.id = b.organization_id AND o.owner_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM employee_memberships em
            WHERE em.organization_id = b.organization_id
              AND em.user_id = auth.uid()
              AND em.role = 'admin'
          )
        )
    )
  );

-- ── EMPLOYEE MEMBERSHIPS: admins can view members of their org ──
DROP POLICY IF EXISTS "employee_memberships_select" ON employee_memberships;
CREATE POLICY "employee_memberships_select" ON employee_memberships
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = employee_memberships.organization_id AND o.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM employee_memberships my_em
      WHERE my_em.organization_id = employee_memberships.organization_id
        AND my_em.user_id = auth.uid()
    )
  );

-- Owner and admins can add employees
DROP POLICY IF EXISTS "employee_memberships_insert" ON employee_memberships;
CREATE POLICY "employee_memberships_insert" ON employee_memberships
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = employee_memberships.organization_id AND o.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM employee_memberships em
      WHERE em.organization_id = employee_memberships.organization_id
        AND em.user_id = auth.uid()
        AND em.role = 'admin'
    )
  );

-- Owner and admins can remove employees (but admins can't remove other admins — enforced in app code)
DROP POLICY IF EXISTS "employee_memberships_delete" ON employee_memberships;
CREATE POLICY "employee_memberships_delete" ON employee_memberships
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = employee_memberships.organization_id AND o.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM employee_memberships em
      WHERE em.organization_id = employee_memberships.organization_id
        AND em.user_id = auth.uid()
        AND em.role = 'admin'
    )
  );
