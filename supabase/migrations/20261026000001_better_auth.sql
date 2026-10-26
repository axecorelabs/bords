-- Better Auth: identity tables, one-time import of Supabase Auth users, and a
-- one-way mirror (auth.users -> ba_*) that keeps both systems consistent until
-- Supabase Auth is retired.
--
-- Design:
--  * User UUIDs are preserved, so every FK to profiles(id) stays valid.
--  * Password hashes (bcrypt) are copied inside the database, never exported.
--  * Tables are only reachable with the service role: RLS is on with no policies.
--  * The mirror triggers swallow their own errors so they can never block a
--    signup/login on the legacy Supabase Auth path.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.ba_user (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL DEFAULT '',
  email          TEXT NOT NULL,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  image          TEXT,
  first_name     TEXT NOT NULL DEFAULT '',
  last_name      TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ba_user_email_key ON public.ba_user (lower(email));

CREATE TABLE public.ba_session (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expires_at  TIMESTAMPTZ NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address  TEXT,
  user_agent  TEXT,
  user_id     UUID NOT NULL REFERENCES public.ba_user(id) ON DELETE CASCADE
);
CREATE INDEX ba_session_user_idx ON public.ba_session (user_id);

CREATE TABLE public.ba_account (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id               TEXT NOT NULL,
  provider_id              TEXT NOT NULL,
  user_id                  UUID NOT NULL REFERENCES public.ba_user(id) ON DELETE CASCADE,
  access_token             TEXT,
  refresh_token            TEXT,
  id_token                 TEXT,
  access_token_expires_at  TIMESTAMPTZ,
  refresh_token_expires_at TIMESTAMPTZ,
  scope                    TEXT,
  password                 TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, account_id)
);
CREATE INDEX ba_account_user_idx ON public.ba_account (user_id);

CREATE TABLE public.ba_verification (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier  TEXT NOT NULL,
  value       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ba_verification_identifier_idx ON public.ba_verification (identifier);

-- Service role only (it bypasses RLS). Anon/authenticated get nothing.
ALTER TABLE public.ba_user         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ba_session      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ba_account      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ba_verification ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ba_user, public.ba_session, public.ba_account, public.ba_verification FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Profiles no longer belong to Supabase Auth
-- ─────────────────────────────────────────────────────────────────────────────
-- Users created through Better Auth never exist in auth.users, so the FK to it
-- has to go. (Re-point it at ba_user after Supabase Auth is retired.)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- ─────────────────────────────────────────────────────────────────────────────
-- New Better Auth users get a profile + personal workspace
-- (what handle_new_user does for auth.users)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ba_handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Rows mirrored from auth.users already get their profile + workspace from the
  -- legacy handle_new_user trigger (which may not have run yet: trigger order is
  -- by name). Creating them here would make that trigger fail on a duplicate key
  -- and block the legacy signup.
  IF EXISTS (SELECT 1 FROM auth.users au WHERE au.id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, email, first_name, last_name, image, provider)
  VALUES (NEW.id, NEW.email, NEW.first_name, NEW.last_name, COALESCE(NEW.image, ''), 'credentials')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (owner_id, name, type)
  SELECT NEW.id, 'Personal', 'personal'
  WHERE NOT EXISTS (
    SELECT 1 FROM public.workspaces w WHERE w.owner_id = NEW.id AND w.type = 'personal'
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER ba_user_created
  AFTER INSERT ON public.ba_user
  FOR EACH ROW EXECUTE FUNCTION public.ba_handle_new_user();

-- Social sign-up: mark the profile's provider (only for users with no password account)
CREATE OR REPLACE FUNCTION public.ba_mark_social_provider()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.provider_id = 'google'
     AND NOT EXISTS (
       SELECT 1 FROM public.ba_account a
       WHERE a.user_id = NEW.user_id AND a.provider_id = 'credential'
     )
  THEN
    UPDATE public.profiles
       SET provider = 'google', provider_id = NEW.account_id
     WHERE id = NEW.user_id AND provider = 'credentials';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ba_account_social_created
  AFTER INSERT ON public.ba_account
  FOR EACH ROW EXECUTE FUNCTION public.ba_mark_social_provider();

-- ─────────────────────────────────────────────────────────────────────────────
-- Mirror: Supabase Auth -> Better Auth (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ba_sync_user(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  u        auth.users%ROWTYPE;
  p_first  TEXT;
  p_last   TEXT;
  v_first  TEXT;
  v_last   TEXT;
  v_full   TEXT;
  v_name   TEXT;
BEGIN
  SELECT * INTO u FROM auth.users WHERE id = p_id;
  IF NOT FOUND OR u.email IS NULL THEN
    RETURN;
  END IF;

  SELECT first_name, last_name INTO p_first, p_last FROM public.profiles WHERE id = p_id;
  v_full  := COALESCE(u.raw_user_meta_data->>'full_name', '');
  v_first := COALESCE(NULLIF(p_first, ''), NULLIF(u.raw_user_meta_data->>'first_name', ''), split_part(v_full, ' ', 1), '');
  v_last  := COALESCE(
    NULLIF(p_last, ''),
    NULLIF(u.raw_user_meta_data->>'last_name', ''),
    CASE WHEN position(' ' IN v_full) > 0 THEN substring(v_full FROM position(' ' IN v_full) + 1) ELSE '' END,
    ''
  );
  v_name := trim(concat_ws(' ', v_first, v_last));
  IF v_name = '' THEN
    v_name := split_part(u.email, '@', 1);
  END IF;

  -- Names/image are only written on first import; after that Better Auth owns them.
  INSERT INTO public.ba_user (id, name, email, email_verified, image, first_name, last_name, created_at, updated_at)
  VALUES (
    u.id, v_name, lower(u.email), u.email_confirmed_at IS NOT NULL,
    NULLIF(u.raw_user_meta_data->>'avatar_url', ''), v_first, v_last, u.created_at, NOW()
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        email_verified = EXCLUDED.email_verified,
        updated_at = NOW();

  -- Email + password account (bcrypt hash copied verbatim)
  IF COALESCE(u.encrypted_password, '') <> '' THEN
    INSERT INTO public.ba_account (account_id, provider_id, user_id, password, created_at, updated_at)
    VALUES (u.id::text, 'credential', u.id, u.encrypted_password, u.created_at, NOW())
    ON CONFLICT (provider_id, account_id) DO UPDATE
      SET password = EXCLUDED.password, updated_at = NOW();
  END IF;

  -- Google
  INSERT INTO public.ba_account (account_id, provider_id, user_id, created_at, updated_at)
  SELECT i.provider_id, 'google', u.id, i.created_at, NOW()
    FROM auth.identities i
   WHERE i.user_id = u.id AND i.provider = 'google'
  ON CONFLICT (provider_id, account_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.ba_sync_user_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    IF TG_TABLE_NAME = 'identities' THEN
      PERFORM public.ba_sync_user(NEW.user_id);
    ELSE
      PERFORM public.ba_sync_user(NEW.id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- Never block the legacy auth path.
    RAISE WARNING 'ba_sync_user failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ba_sync_auth_users
  AFTER INSERT OR UPDATE OF email, encrypted_password, email_confirmed_at ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.ba_sync_user_trigger();

CREATE TRIGGER ba_sync_auth_identities
  AFTER INSERT ON auth.identities
  FOR EACH ROW EXECUTE FUNCTION public.ba_sync_user_trigger();

-- ─────────────────────────────────────────────────────────────────────────────
-- One-time import of every existing user
-- ─────────────────────────────────────────────────────────────────────────────
SELECT public.ba_sync_user(id) FROM auth.users;
