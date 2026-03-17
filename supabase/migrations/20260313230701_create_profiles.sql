-- Profiles table: extends Supabase auth.users with app-specific fields
CREATE TABLE profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          TEXT UNIQUE NOT NULL,
  first_name     TEXT NOT NULL DEFAULT '',
  last_name      TEXT NOT NULL DEFAULT '',
  image          TEXT,
  provider       TEXT NOT NULL DEFAULT 'credentials' CHECK (provider IN ('credentials', 'google')),
  provider_id    TEXT,
  mfa_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  lock_until     TIMESTAMPTZ,
  last_login_at  TIMESTAMPTZ,
  last_login_ip  INET,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_email ON profiles(email);

-- Auto-update updated_at on row change
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
