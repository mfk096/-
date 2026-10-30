-- 1.0.1: вход по логину без почты. У профиля появляется логин (username).
-- Логин: a-z0-9._-, 3–32 символа, уникален без учёта регистра, хранится в нижнем регистре.
-- Учётка без почты живёт в Auth с техническим адресом <логин>@inventory.local.
-- Файл идемпотентный. anon не получает EXECUTE. storage.objects здесь не трогаем.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

COMMENT ON COLUMN public.profiles.username IS
  'Логин для входа. Без почты вход идёт как <логин>@inventory.local.';

-- Свободный логин на основе заготовки: чистим символы, добиваем до 3, при занятости
-- добавляем -2, -3 и так далее.
CREATE OR REPLACE FUNCTION public.pick_username(p_raw text, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_try text;
  v_n integer := 1;
BEGIN
  v_base := regexp_replace(lower(COALESCE(btrim(p_raw), '')), '[^a-z0-9._-]', '', 'g');
  IF length(v_base) < 3 THEN
    v_base := v_base || 'user';
  END IF;
  v_base := left(v_base, 28);
  v_try := v_base;
  WHILE EXISTS (
    SELECT 1 FROM public.profiles
    WHERE lower(username) = v_try AND id IS DISTINCT FROM p_user_id
  ) LOOP
    v_n := v_n + 1;
    v_try := v_base || '-' || v_n::text;
  END LOOP;
  RETURN v_try;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_name text;
  v_email text := NULLIF(btrim(NEW.email), '');
  v_username text;
BEGIN
  v_name := COALESCE(
    NULLIF(btrim(v_meta->>'full_name'), ''),
    NULLIF(btrim(v_meta->>'name'), ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'Пользователь'
  );
  v_username := public.pick_username(
    COALESCE(NULLIF(btrim(v_meta->>'username'), ''), split_part(COALESCE(NEW.email, ''), '@', 1)),
    NEW.id
  );

  INSERT INTO public.profiles (id, full_name, role, email, username)
  VALUES (NEW.id, v_name, 'viewer', v_email, v_username)
  ON CONFLICT (id) DO UPDATE
    SET username = COALESCE(public.profiles.username, EXCLUDED.username);

  RETURN NEW;
END;
$$;

-- Заполнить логины у уже существующих профилей.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.id, COALESCE(p.email, u.email) AS email
    FROM public.profiles AS p
    LEFT JOIN auth.users AS u ON u.id = p.id
    WHERE p.username IS NULL
    ORDER BY p.created_at, p.id
  LOOP
    UPDATE public.profiles
    SET username = public.pick_username(split_part(COALESCE(r.email, ''), '@', 1), r.id)
    WHERE id = r.id;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_uidx
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL;

DO $$
BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_username_format
    CHECK (username IS NULL OR username ~ '^[a-z0-9._-]{3,32}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pick_username(text, uuid) FROM PUBLIC, anon, authenticated;
