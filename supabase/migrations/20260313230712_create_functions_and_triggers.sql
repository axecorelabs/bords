-- Functions and triggers

-- ============================================================
-- 1. handle_new_user: auto-create profile + personal workspace on signup
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _first_name TEXT;
  _last_name TEXT;
  _image TEXT;
  _provider TEXT;
BEGIN
  -- Extract metadata from Supabase Auth
  _first_name := COALESCE(
    NEW.raw_user_meta_data->>'first_name',
    split_part(COALESCE(NEW.raw_user_meta_data->>'full_name', ''), ' ', 1),
    ''
  );
  _last_name := COALESCE(
    NEW.raw_user_meta_data->>'last_name',
    CASE
      WHEN NEW.raw_user_meta_data->>'full_name' IS NOT NULL
        AND position(' ' in NEW.raw_user_meta_data->>'full_name') > 0
      THEN substring(NEW.raw_user_meta_data->>'full_name' from position(' ' in NEW.raw_user_meta_data->>'full_name') + 1)
      ELSE ''
    END
  );
  _image := COALESCE(NEW.raw_user_meta_data->>'avatar_url', '');
  _provider := CASE
    WHEN NEW.raw_app_meta_data->>'provider' = 'google' THEN 'google'
    ELSE 'credentials'
  END;

  -- Create profile
  INSERT INTO public.profiles (id, email, first_name, last_name, image, provider, provider_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    _first_name,
    _last_name,
    _image,
    _provider,
    CASE WHEN _provider = 'google' THEN NEW.raw_user_meta_data->>'sub' ELSE NULL END
  );

  -- Create personal workspace
  INSERT INTO public.workspaces (owner_id, name, type)
  VALUES (NEW.id, 'Personal', 'personal');

  RETURN NEW;
END;
$$;

-- Trigger: fires after insert on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. publish_board: atomic publish with task assignment sync
-- ============================================================
CREATE OR REPLACE FUNCTION public.publish_board(
  p_bord_id UUID,
  p_published_by UUID,
  p_assignments JSONB DEFAULT '[]'::jsonb,
  p_unassign_ids UUID[] DEFAULT '{}'::uuid[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _version INTEGER;
  _new_count INTEGER := 0;
  _reassign_count INTEGER := 0;
  _unassign_count INTEGER := 0;
  _assignment JSONB;
  _snap_id UUID;
BEGIN
  -- Verify ownership
  IF NOT EXISTS (
    SELECT 1 FROM public.bords WHERE id = p_bord_id AND owner_id = p_published_by
  ) THEN
    RAISE EXCEPTION 'Not authorized to publish this board';
  END IF;

  -- Get next version
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO _version
  FROM public.publish_snapshots WHERE bord_id = p_bord_id;

  -- Soft-delete unassigned tasks
  UPDATE public.task_assignments
  SET is_deleted = TRUE, status = 'draft', updated_at = NOW()
  WHERE id = ANY(p_unassign_ids) AND bord_id = p_bord_id;
  GET DIAGNOSTICS _unassign_count = ROW_COUNT;

  -- Upsert assignments
  FOR _assignment IN SELECT * FROM jsonb_array_elements(p_assignments)
  LOOP
    IF _assignment->>'id' IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.task_assignments WHERE id = (_assignment->>'id')::uuid
    ) THEN
      -- Update existing
      UPDATE public.task_assignments SET
        content      = COALESCE(_assignment->>'content', content),
        assigned_to  = COALESCE((_assignment->>'assigned_to')::uuid, assigned_to),
        priority     = COALESCE(_assignment->>'priority', priority),
        due_date     = CASE WHEN _assignment->>'due_date' IS NOT NULL THEN (_assignment->>'due_date')::timestamptz ELSE due_date END,
        status       = 'assigned',
        published_at = NOW(),
        column_id    = COALESCE(_assignment->>'column_id', column_id),
        column_title = COALESCE(_assignment->>'column_title', column_title),
        updated_at   = NOW()
      WHERE id = (_assignment->>'id')::uuid;
      _reassign_count := _reassign_count + 1;
    ELSE
      -- Insert new
      INSERT INTO public.task_assignments (
        bord_id, workspace_id, organization_id, context_type,
        source_type, source_id, content, assigned_to, assigned_by,
        priority, due_date, status, published_at, column_id, column_title
      ) VALUES (
        p_bord_id,
        (_assignment->>'workspace_id')::uuid,
        (_assignment->>'organization_id')::uuid,
        COALESCE(_assignment->>'context_type', 'organization'),
        _assignment->>'source_type',
        _assignment->>'source_id',
        _assignment->>'content',
        (_assignment->>'assigned_to')::uuid,
        p_published_by,
        COALESCE(_assignment->>'priority', 'normal'),
        CASE WHEN _assignment->>'due_date' IS NOT NULL THEN (_assignment->>'due_date')::timestamptz ELSE NULL END,
        'assigned',
        NOW(),
        _assignment->>'column_id',
        _assignment->>'column_title'
      );
      _new_count := _new_count + 1;
    END IF;
  END LOOP;

  -- Create publish snapshot
  INSERT INTO public.publish_snapshots (bord_id, version_number, published_by, new_assignments, reassignments, unassignments)
  VALUES (p_bord_id, _version, p_published_by, _new_count, _reassign_count, _unassign_count)
  RETURNING id INTO _snap_id;

  -- Update bord last published timestamp
  UPDATE public.bords SET last_published_at = NOW() WHERE id = p_bord_id;

  -- Reset unpublished change tracker
  DELETE FROM public.unpublished_change_tracker WHERE bord_id = p_bord_id;

  RETURN jsonb_build_object(
    'snapshot_id', _snap_id,
    'version', _version,
    'new_assignments', _new_count,
    'reassignments', _reassign_count,
    'unassignments', _unassign_count
  );
END;
$$;

-- ============================================================
-- 3. accept_invitation: atomic invitation acceptance
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_invitation(
  p_token TEXT,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _inv RECORD;
BEGIN
  -- Find and validate invitation
  SELECT * INTO _inv FROM public.invitations
  WHERE token = p_token AND status = 'pending' AND expires_at > NOW();

  IF _inv IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired invitation';
  END IF;

  -- Verify email matches
  IF _inv.email != (SELECT email FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Invitation email does not match your account';
  END IF;

  -- Mark invitation accepted
  UPDATE public.invitations SET status = 'accepted' WHERE id = _inv.id;

  -- Handle based on role
  IF _inv.role = 'employee' THEN
    -- Add as employee
    INSERT INTO public.employee_memberships (organization_id, user_id)
    VALUES (_inv.organization_id, p_user_id)
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  ELSIF _inv.role = 'collaborator' AND _inv.bord_id IS NOT NULL THEN
    -- Add to bord_access_list
    INSERT INTO public.bord_access_list (bord_id, user_id, permission)
    VALUES (_inv.bord_id, p_user_id, COALESCE(_inv.collaborator_role, 'view'))
    ON CONFLICT (bord_id, user_id) DO UPDATE SET permission = EXCLUDED.permission;

    -- Add as bord member
    INSERT INTO public.bord_members (bord_id, user_id, role)
    VALUES (_inv.bord_id, p_user_id, COALESCE(_inv.collaborator_role, 'viewer'))
    ON CONFLICT (bord_id, user_id) DO UPDATE SET role = EXCLUDED.role;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'organization_id', _inv.organization_id,
    'role', _inv.role,
    'bord_id', _inv.bord_id
  );
END;
$$;

-- ============================================================
-- 4. find_boards_with_deadlines: query for cron reminder scanning
-- ============================================================
CREATE OR REPLACE FUNCTION public.find_boards_with_deadlines(
  p_deadline_before TIMESTAMPTZ
)
RETURNS TABLE (
  board_doc_id UUID,
  local_board_id TEXT,
  owner_id UUID,
  owner_email TEXT,
  checklists JSONB,
  kanban_boards JSONB,
  reminders JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bd.id AS board_doc_id,
    bd.local_board_id,
    bd.owner_id,
    p.email AS owner_email,
    bd.checklists,
    bd.kanban_boards,
    bd.reminders
  FROM public.board_documents bd
  JOIN public.profiles p ON p.id = bd.owner_id
  WHERE
    -- Has checklist items with due dates
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(bd.checklists) cl,
        jsonb_array_elements(cl->'items') item
      WHERE (item->>'dueDate')::timestamptz <= p_deadline_before
        AND (item->>'completed')::boolean IS NOT TRUE
    )
    OR
    -- Has kanban tasks with due dates
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(bd.kanban_boards) kb,
        jsonb_array_elements(kb->'columns') col,
        jsonb_array_elements(col->'tasks') task
      WHERE (task->>'dueDate')::timestamptz <= p_deadline_before
        AND (task->>'completed')::boolean IS NOT TRUE
    )
    OR
    -- Has reminder items with due dates
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(bd.reminders) rem,
        jsonb_array_elements(rem->'items') item
      WHERE (item->>'dueDate')::timestamptz <= p_deadline_before
        AND (item->>'completed')::boolean IS NOT TRUE
    );
END;
$$;

-- ============================================================
-- 5. cleanup_sent_reminders: periodic cleanup (call from pg_cron)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_sent_reminders()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.sent_reminders WHERE sent_at < NOW() - INTERVAL '48 hours';
$$;

-- Schedule cleanup every hour via pg_cron (if pg_cron is enabled)
-- Uncomment the following if pg_cron extension is available:
-- SELECT cron.schedule('cleanup-sent-reminders', '0 * * * *', 'SELECT public.cleanup_sent_reminders()');
