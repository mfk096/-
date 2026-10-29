-- Профили: email, потолок 10 активных, запрет снять последнего администратора
-- и отключить себя. Файл идемпотентный. Уже применённые миграции не меняются.
-- anon не получает EXECUTE. storage.objects здесь не трогаем.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text;

COMMENT ON COLUMN public.profiles.email IS
  'Email из auth.users. Нужен списку пользователей: клиент чужие адреса Auth не читает.';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_name text;
BEGIN
  v_name := COALESCE(
    NULLIF(btrim(v_meta->>'full_name'), ''),
    NULLIF(btrim(v_meta->>'name'), ''),
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'Пользователь'
  );

  INSERT INTO public.profiles (id, full_name, role, email)
  VALUES (NEW.id, v_name, 'viewer', NULLIF(btrim(NEW.email), ''))
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET email = NULLIF(btrim(NEW.email), '')
  WHERE id = NEW.id
    AND email IS DISTINCT FROM NULLIF(btrim(NEW.email), '');

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_profile_from_auth() IS
  'Копирует email из auth.users в профиль. Через RPC не вызывается.';

-- Свою роль по-прежнему режет profiles_prevent_self_role_change, он срабатывает раньше
-- по имени. Здесь — чужой последний администратор, своё отключение и потолок в 10 человек.
CREATE OR REPLACE FUNCTION public.enforce_profile_admin_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_other_admins integer;
  v_active integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF auth.uid() IS NOT NULL
      AND auth.uid() = NEW.id
      AND OLD.is_active
      AND NOT NEW.is_active THEN
      RAISE EXCEPTION 'Нельзя отключить собственную учётную запись';
    END IF;

    IF OLD.role = 'admin'
      AND OLD.is_active
      AND (NEW.role IS DISTINCT FROM 'admin'::public.app_role OR NOT NEW.is_active)
      AND (auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM NEW.id) THEN
      SELECT count(*)
      INTO v_other_admins
      FROM public.profiles
      WHERE role = 'admin'
        AND is_active
        AND id <> OLD.id;

      IF v_other_admins = 0 THEN
        RAISE EXCEPTION 'Нельзя снять роль или отключить последнего администратора';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.is_active THEN
    SELECT count(*)
    INTO v_active
    FROM public.profiles
    WHERE is_active
      AND id <> NEW.id;

    IF v_active >= 10 THEN
      RAISE EXCEPTION 'Одновременно может быть не больше 10 активных пользователей';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.is_active AND NOT OLD.is_active THEN
    SELECT count(*)
    INTO v_active
    FROM public.profiles
    WHERE is_active
      AND id <> NEW.id;

    IF v_active >= 10 THEN
      RAISE EXCEPTION 'Одновременно может быть не больше 10 активных пользователей';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_profile_admin_rules() IS
  'Не больше 10 активных профилей. Нельзя отключить себя и снять последнего администратора.';

CREATE OR REPLACE FUNCTION public.backfill_profiles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role, email)
  SELECT
    u.id,
    COALESCE(
      NULLIF(btrim(COALESCE(u.raw_user_meta_data, '{}'::jsonb)->>'full_name'), ''),
      NULLIF(btrim(COALESCE(u.raw_user_meta_data, '{}'::jsonb)->>'name'), ''),
      NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
      'Пользователь'
    ),
    'viewer'::public.app_role,
    NULLIF(btrim(u.email), '')
  FROM auth.users AS u
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = u.id
  );

  UPDATE public.profiles AS p
  SET email = NULLIF(btrim(u.email), '')
  FROM auth.users AS u
  WHERE u.id = p.id
    AND p.email IS DISTINCT FROM NULLIF(btrim(COALESCE(u.email, '')), '');

  UPDATE public.profiles AS p
  SET role = 'admin'
  FROM auth.users AS u
  WHERE u.id = p.id
    AND lower(COALESCE(u.email, '')) = lower('kb09062001@gmail.com')
    AND p.role IS DISTINCT FROM 'admin';
END;
$$;

DROP TRIGGER IF EXISTS profiles_zz_admin_rules ON public.profiles;

CREATE TRIGGER profiles_zz_admin_rules
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_admin_rules();

DROP TRIGGER IF EXISTS profiles_sync_auth_email ON auth.users;

CREATE TRIGGER profiles_sync_auth_email
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_from_auth();

UPDATE public.profiles AS p
SET email = NULLIF(btrim(u.email), '')
FROM auth.users AS u
WHERE u.id = p.id
  AND p.email IS DISTINCT FROM NULLIF(btrim(COALESCE(u.email, '')), '');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_uidx
  ON public.profiles (lower(email))
  WHERE email IS NOT NULL;

-- На Supabase новая функция в public сразу получает EXECUTE для anon и authenticated.
-- REVOKE только у PUBLIC это право не снимает. Триггеру EXECUTE вызывающего не нужен.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_profiles() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_profile_from_auth() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_profile_admin_rules() FROM PUBLIC, anon, authenticated;
