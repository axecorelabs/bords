-- Push row changes to the realtime Worker (replaces browser-side Supabase Realtime
-- subscriptions, which need a Supabase JWT that Better Auth sessions don't have).
--
--   notifications  -> POST {url}/events -> that user's open sockets refetch
--   board_comments -> POST {url}/events -> everyone in the board room gets the comment
--
-- Writer-agnostic: fires no matter which route or job changed the row. The HTTP
-- call is queued by pg_net after commit, so it never slows or fails a transaction.
--
-- The target URL and shared secret live in realtime_push_config, set out of band
-- (never committed):  insert into realtime_push_config (id, url, secret) values (1, '<https://realtime host>', '<INTERNAL_API_SECRET>');

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.realtime_push_config (
  id     INTEGER PRIMARY KEY CHECK (id = 1),
  url    TEXT NOT NULL,
  secret TEXT NOT NULL
);
ALTER TABLE public.realtime_push_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.realtime_push_config FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.push_realtime_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  cfg      public.realtime_push_config%ROWTYPE;
  v_new    JSONB;
  v_old    JSONB;
BEGIN
  BEGIN
    SELECT * INTO cfg FROM public.realtime_push_config WHERE id = 1;
    IF FOUND THEN
      IF TG_OP <> 'DELETE' THEN v_new := to_jsonb(NEW); END IF;
      IF TG_OP <> 'INSERT' THEN v_old := to_jsonb(OLD); END IF;

      -- Notifications only need to say "something changed" for this user.
      IF TG_TABLE_NAME = 'notifications' THEN
        v_new := CASE WHEN v_new IS NULL THEN NULL ELSE jsonb_build_object('user_id', v_new->'user_id', 'id', v_new->'id') END;
        v_old := CASE WHEN v_old IS NULL THEN NULL ELSE jsonb_build_object('user_id', v_old->'user_id', 'id', v_old->'id') END;
      END IF;

      PERFORM net.http_post(
        url := rtrim(cfg.url, '/') || '/events',
        body := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'record', v_new, 'old', v_old),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cfg.secret),
        timeout_milliseconds := 3000
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Realtime is best-effort; never fail the write that triggered it.
    RAISE WARNING 'push_realtime_event failed: %', SQLERRM;
  END;
  RETURN NULL;
END;
$$;

CREATE TRIGGER notifications_push_realtime
  AFTER INSERT OR UPDATE OR DELETE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.push_realtime_event();

CREATE TRIGGER board_comments_push_realtime
  AFTER INSERT OR DELETE ON public.board_comments
  FOR EACH ROW EXECUTE FUNCTION public.push_realtime_event();
