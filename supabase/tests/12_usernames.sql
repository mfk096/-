-- 1.0.1: логины. Повтор миграции безопасен, бэкфилл заполнил логин, коллизии получают суффикс,
-- уникальность без учёта регистра, anon не вызывает новые функции.

\ir ../migrations/20261030090000_usernames.sql

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.pick_username(text, uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.pick_username(text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: pick_username доступна anon или authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE username IS NULL) THEN
    RAISE EXCEPTION 'FAIL: бэкфилл оставил профиль без логина';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = '11111111-1111-4111-8111-111111111111' AND username = 'tester'
  ) THEN
    RAISE EXCEPTION 'FAIL: логин администратора не взят из email';
  END IF;
  RAISE NOTICE 'ok: usernames backfill';
END;
$$;

BEGIN;
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('99999999-9999-4999-8999-999999999991', 'tester@other.example', '{"full_name":"Двойник"}'),
  ('99999999-9999-4999-8999-999999999992', 'ivanov@inventory.local', '{"full_name":"Иванов","username":"Ivanov"}');

DO $$
BEGIN
  IF (SELECT username FROM public.profiles WHERE id = '99999999-9999-4999-8999-999999999991') <> 'tester-2' THEN
    RAISE EXCEPTION 'FAIL: коллизия логина не разрешена суффиксом';
  END IF;
  IF (SELECT username FROM public.profiles WHERE id = '99999999-9999-4999-8999-999999999992') <> 'ivanov' THEN
    RAISE EXCEPTION 'FAIL: логин из метаданных не приведён к нижнему регистру';
  END IF;
  BEGIN
    UPDATE public.profiles SET username = 'IVANOV' WHERE id = '99999999-9999-4999-8999-999999999991';
    RAISE EXCEPTION 'FAIL: дубль логина в другом регистре прошёл';
  EXCEPTION
    WHEN unique_violation OR check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.profiles SET username = 'ivanov' WHERE id = '99999999-9999-4999-8999-999999999991';
    RAISE EXCEPTION 'FAIL: дубль логина прошёл';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
  RAISE NOTICE 'ok: usernames unique';
END;
$$;
ROLLBACK;
