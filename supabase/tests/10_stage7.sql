-- Повтор миграции этапа 7 не возвращает EXECUTE и не ломает уже созданные профили.
-- anon и authenticated не вызывают новые триггерные функции через RPC.

\ir ../migrations/20261029121600_profiles_admin.sql

DO $$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public.sync_profile_from_auth()',
    'public.enforce_profile_admin_rules()',
    'public.handle_new_user()',
    'public.backfill_profiles()'
  ]
  LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE')
      OR has_function_privilege('public', v_sig, 'EXECUTE')
      OR has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: % доступна anon, PUBLIC или authenticated', v_sig;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = '11111111-1111-4111-8111-111111111111'
      AND email = 'tester@example.com'
  ) THEN
    RAISE EXCEPTION 'FAIL: email администратора не заполнен';
  END IF;

  RAISE NOTICE 'ok: stage7 privileges and backfill email';
END;
$$;

BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '88888888-8888-4888-8888-888888888881',
  '  Stage7.User@example.com ',
  '{"full_name":"Этап семь"}'::jsonb
);

DO $$
DECLARE
  v_email text;
  v_name text;
  v_role public.app_role;
BEGIN
  SELECT email, full_name, role
  INTO v_email, v_name, v_role
  FROM public.profiles
  WHERE id = '88888888-8888-4888-8888-888888888881';

  IF v_email IS DISTINCT FROM 'Stage7.User@example.com'
    OR v_name IS DISTINCT FROM 'Этап семь'
    OR v_role IS DISTINCT FROM 'viewer' THEN
    RAISE EXCEPTION 'FAIL: профиль % / % / %', v_email, v_name, v_role;
  END IF;
END;
$$;

UPDATE auth.users
SET email = 'renamed.stage7@example.com'
WHERE id = '88888888-8888-4888-8888-888888888881';

DO $$
BEGIN
  IF (
    SELECT email
    FROM public.profiles
    WHERE id = '88888888-8888-4888-8888-888888888881'
  ) IS DISTINCT FROM 'renamed.stage7@example.com' THEN
    RAISE EXCEPTION 'FAIL: email профиля не синхронизировался';
  END IF;

  BEGIN
    INSERT INTO auth.users (id, email)
    VALUES ('88888888-8888-4888-8888-888888888882', 'Renamed.Stage7@example.com');
    RAISE EXCEPTION 'FAIL: повтор email принят';
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;

  RAISE NOTICE 'ok: profile email';
END;
$$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '', true);
UPDATE public.profiles
SET role = 'viewer'
WHERE role = 'admin'
  AND id <> '11111111-1111-4111-8111-111111111111';

DO $$
BEGIN
  BEGIN
    UPDATE public.profiles
    SET role = 'viewer'
    WHERE id = '11111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'FAIL: последнего администратора сняли';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%последнего администратора%' THEN
        RAISE;
      END IF;
  END;

  IF (
    SELECT role
    FROM public.profiles
    WHERE id = '11111111-1111-4111-8111-111111111111'
  ) IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'FAIL: роль последнего администратора изменилась';
  END IF;

  RAISE NOTICE 'ok: last admin';
END;
$$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);
UPDATE public.profiles
SET role = 'viewer'
WHERE role = 'admin'
  AND id <> '11111111-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;

DO $$
BEGIN
  BEGIN
    UPDATE public.profiles
    SET role = 'viewer'
    WHERE id = '11111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'FAIL: последний администратор сменил себе роль';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%собственную роль%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE public.profiles
    SET is_active = false
    WHERE id = '11111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'FAIL: себя отключили';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%собственную учётную%' THEN
        RAISE;
      END IF;
  END;

  RAISE NOTICE 'ok: self role and self deactivate';
END;
$$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111113', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111113","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;

UPDATE public.profiles
SET is_active = false
WHERE id = '11111111-1111-4111-8111-111111111112';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = '11111111-1111-4111-8111-111111111112'
      AND is_active
  ) THEN
    RAISE EXCEPTION 'FAIL: зритель отключил редактора';
  END IF;
  RAISE NOTICE 'ok: viewer cannot deactivate';
END;
$$;
ROLLBACK;

BEGIN;
DO $$
DECLARE
  v_active integer;
  v_i integer := 0;
  v_id uuid;
BEGIN
  SELECT count(*) INTO v_active FROM public.profiles WHERE is_active;

  WHILE v_active < 10 LOOP
    v_id := gen_random_uuid();
    INSERT INTO auth.users (id, email)
    VALUES (v_id, format('stage7-limit-%s@example.com', v_i));
    v_active := v_active + 1;
    v_i := v_i + 1;
  END LOOP;

  BEGIN
    INSERT INTO auth.users (id, email)
    VALUES (gen_random_uuid(), 'stage7-limit-extra@example.com');
    RAISE EXCEPTION 'FAIL: одиннадцатый активный пользователь создан';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%10 активных%' THEN
        RAISE;
      END IF;
  END;

  RAISE NOTICE 'ok: active user limit';
END;
$$;
ROLLBACK;
