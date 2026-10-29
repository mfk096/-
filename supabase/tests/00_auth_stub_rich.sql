-- Более полная заглушка auth.users: так seed проверяется на столбцах, похожих на GoTrue.
-- Тоже только для локальных тестов, не миграция.

\ir 00_auth_stub.sql

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS instance_id uuid,
  ADD COLUMN IF NOT EXISTS aud text,
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS encrypted_password text,
  ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_token text,
  ADD COLUMN IF NOT EXISTS recovery_token text,
  ADD COLUMN IF NOT EXISTS email_change text,
  ADD COLUMN IF NOT EXISTS email_change_token_new text,
  ADD COLUMN IF NOT EXISTS email_change_token_current text,
  ADD COLUMN IF NOT EXISTS email_change_confirm_status smallint,
  ADD COLUMN IF NOT EXISTS is_sso_user boolean,
  ADD COLUMN IF NOT EXISTS is_anonymous boolean;

UPDATE auth.users
SET
  instance_id = COALESCE(instance_id, '00000000-0000-0000-0000-000000000000'),
  aud = COALESCE(aud, 'authenticated'),
  role = COALESCE(role, 'authenticated'),
  encrypted_password = COALESCE(encrypted_password, ''),
  raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb),
  updated_at = COALESCE(updated_at, now()),
  confirmation_token = COALESCE(confirmation_token, ''),
  recovery_token = COALESCE(recovery_token, ''),
  email_change = COALESCE(email_change, ''),
  email_change_token_new = COALESCE(email_change_token_new, ''),
  email_change_token_current = COALESCE(email_change_token_current, ''),
  email_change_confirm_status = COALESCE(email_change_confirm_status, 0),
  is_sso_user = COALESCE(is_sso_user, false),
  is_anonymous = COALESCE(is_anonymous, false);

ALTER TABLE auth.users
  ALTER COLUMN instance_id SET NOT NULL,
  ALTER COLUMN aud SET NOT NULL,
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN encrypted_password SET NOT NULL,
  ALTER COLUMN raw_app_meta_data SET NOT NULL,
  ALTER COLUMN confirmation_token SET NOT NULL,
  ALTER COLUMN recovery_token SET NOT NULL,
  ALTER COLUMN email_change SET NOT NULL,
  ALTER COLUMN email_change_token_new SET NOT NULL,
  ALTER COLUMN email_change_token_current SET NOT NULL,
  ALTER COLUMN email_change_confirm_status SET NOT NULL,
  ALTER COLUMN is_sso_user SET NOT NULL,
  ALTER COLUMN is_anonymous SET NOT NULL;

CREATE TABLE IF NOT EXISTS auth.identities (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  identity_data jsonb NOT NULL,
  provider text NOT NULL,
  provider_id text NOT NULL,
  last_sign_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);
