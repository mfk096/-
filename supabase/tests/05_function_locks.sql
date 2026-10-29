-- anon и authenticated не вызывают триггеры и backfill через RPC.
-- authenticated вызывает current_role и move/change. Триггеры при этом живы.
-- Повтор миграции не должен снять GRANT у RPC.

\ir ../migrations/20261029120900_lock_down_functions.sql

DO $$
DECLARE
  v_sig text;
  v_locked text[] := ARRAY[
    'public.set_updated_at()',
    'public.nomenclature_before_write()',
    'public.nomenclature_after_insert_counter()',
    'public.code_counters_guard()',
    'public.equipment_before_write()',
    'public.forbid_equipment_delete()',
    'public.forbid_history_delete()',
    'public.movements_before_write()',
    'public.status_changes_before_write()',
    'public.equipment_write_history()',
    'public.verifications_before_write()',
    'public.verifications_after_write()',
    'public.locations_prevent_cycle()',
    'public.handle_new_user()',
    'public.prevent_self_role_change()',
    'public.backfill_profiles()',
    'public.move_equipment(uuid,uuid,text)',
    'public.change_equipment_status(uuid,public.equipment_status,text)'
  ];
  v_role text;
BEGIN
  FOREACH v_sig IN ARRAY v_locked LOOP
    FOREACH v_role IN ARRAY ARRAY['anon', 'public'] LOOP
      IF has_function_privilege(v_role, v_sig, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: % всё ещё может вызвать %', v_role, v_sig;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_sig IN ARRAY v_locked LOOP
    IF v_sig LIKE 'public.move_equipment%' OR v_sig LIKE 'public.change_equipment_status%' THEN
      CONTINUE;
    END IF;
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated может вызвать %', v_sig;
    END IF;
  END LOOP;

  IF NOT has_function_privilege('authenticated', 'public.current_role()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: authenticated не может вызвать current_role()';
  END IF;
  IF has_function_privilege('anon', 'public.current_role()', 'EXECUTE')
    OR has_function_privilege('public', 'public.current_role()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: current_role() доступна anon или PUBLIC';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.move_equipment(uuid,uuid,text)', 'EXECUTE')
    OR NOT has_function_privilege(
      'authenticated',
      'public.change_equipment_status(uuid,public.equipment_status,text)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'FAIL: у authenticated нет RPC перемещения или статуса';
  END IF;

  RAISE NOTICE 'ok: execute privileges';
END;
$$;

-- Прямой вызов от anon — отказ в правах, не тело функции.
BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.backfill_profiles();
    RAISE EXCEPTION 'FAIL: anon вызвал backfill_profiles';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM public.equipment_before_write();
    RAISE EXCEPTION 'FAIL: anon вызвал equipment_before_write';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM public.handle_new_user();
    RAISE EXCEPTION 'FAIL: anon вызвал handle_new_user';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM public.nomenclature_after_insert_counter();
    RAISE EXCEPTION 'FAIL: anon вызвал nomenclature_after_insert_counter';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM public.current_role();
    RAISE EXCEPTION 'FAIL: anon вызвал current_role';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM public.move_equipment(
      '00000000-0000-0000-0000-000000000000',
      NULL,
      NULL
    );
    RAISE EXCEPTION 'FAIL: anon вызвал move_equipment';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  RAISE NOTICE 'ok: anon calls denied';
END;
$$;
ROLLBACK;

-- authenticated: current_role и RPC работают, триггерные функции — нет.
-- Вставка единицы всё равно получает код.
BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111112', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111112","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_code text;
  v_eq uuid;
  v_comment text;
BEGIN
  IF public.current_role() <> 'editor' THEN
    RAISE EXCEPTION 'FAIL: current_role() под редактором = %', public.current_role();
  END IF;

  BEGIN
    PERFORM public.equipment_before_write();
    RAISE EXCEPTION 'FAIL: редактор вызвал equipment_before_write';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM public.backfill_profiles();
    RAISE EXCEPTION 'FAIL: редактор вызвал backfill_profiles';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  INSERT INTO public.equipment (nomenclature_id, code, serial_number, status, location_id)
  SELECT id, 'LEAK-1', 'lock-serial', 'in_work', '55555555-5555-4555-8555-555555555553'::uuid
  FROM public.nomenclature
  WHERE code_prefix = 'FIX'
  RETURNING id, code INTO v_eq, v_code;

  IF v_code IS NULL OR v_code = 'LEAK-1' OR v_code NOT LIKE 'FIX-%' THEN
    RAISE EXCEPTION 'FAIL: триггер кода после REVOKE выдал %', v_code;
  END IF;

  PERFORM public.change_equipment_status(v_eq, 'reserve', 'проверка rpc');
  PERFORM public.move_equipment(
    v_eq,
    '55555555-5555-4555-8555-555555555551',
    'проверка rpc'
  );

  SELECT m.comment
  INTO v_comment
  FROM public.movements AS m
  WHERE m.equipment_id = v_eq
    AND m.comment = 'проверка rpc';
  IF v_comment IS NULL THEN
    RAISE EXCEPTION 'FAIL: move_equipment после закрытия прав не записал комментарий';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.status_changes AS s
    WHERE s.equipment_id = v_eq
      AND s.to_status = 'reserve'
      AND s.comment = 'проверка rpc'
  ) THEN
    RAISE EXCEPTION 'FAIL: change_equipment_status после закрытия прав';
  END IF;

  RAISE NOTICE 'ok: authenticated rpc and code trigger';
END;
$$;
ROLLBACK;

-- Профиль создаётся триггером, даже если вставляющий не может вызвать handle_new_user().
DO $$
BEGIN
  CREATE ROLE auth_writer NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

GRANT USAGE ON SCHEMA auth TO auth_writer;
GRANT INSERT ON TABLE auth.users TO auth_writer;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM auth_writer;

BEGIN;
SET LOCAL ROLE auth_writer;
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES (
  '77777777-7777-4777-8777-777777777777',
  'trigger-lock@example.com',
  '{"full_name":"Проверка триггера"}'::jsonb
);
RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = '77777777-7777-4777-8777-777777777777'
      AND role = 'viewer'
      AND full_name = 'Проверка триггера'
  ) THEN
    RAISE EXCEPTION 'FAIL: триггер профиля не создал viewer';
  END IF;
  IF has_function_privilege('auth_writer', 'public.handle_new_user()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: auth_writer может вызвать handle_new_user';
  END IF;
  RAISE NOTICE 'ok: profile trigger without execute';
END;
$$;
ROLLBACK;

-- Новая функция больше не достаётся anon через default privileges.
CREATE FUNCTION public.lockdown_probe()
RETURNS integer
LANGUAGE sql
AS $$
  SELECT 1;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.lockdown_probe()', 'EXECUTE')
    OR has_function_privilege('public', 'public.lockdown_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: default privileges снова отдают EXECUTE anon или PUBLIC';
  END IF;
  RAISE NOTICE 'ok: default privileges';
END;
$$;

DROP FUNCTION public.lockdown_probe();
