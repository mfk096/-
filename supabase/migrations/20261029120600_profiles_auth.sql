-- Профиль создаётся вместе с пользователем Auth. Роль по умолчанию — viewer.
-- Свою роль пользователь не меняет, в том числе администратор.

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

  INSERT INTO public.profiles (id, full_name, role)
  VALUES (NEW.id, v_name, 'viewer')
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_on_auth_user_created ON auth.users;

CREATE TRIGGER profiles_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.prevent_self_role_change()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
    AND auth.uid() = NEW.id
    AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Нельзя изменить собственную роль';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_self_role_change ON public.profiles;

CREATE TRIGGER profiles_prevent_self_role_change
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_role_change();
