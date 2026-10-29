-- anon не исполняет функции public (кроме объектов расширений).
-- authenticated по-прежнему вызывает чтение пути и RPC.
-- Повтор миграции не возвращает anon и не снимает authenticated.

\ir ../migrations/20261029121100_revoke_anon_functions.sql

DO $$
DECLARE
  v_left text;
BEGIN
  SELECT string_agg(format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ', ')
  INTO v_left
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend AS d
      WHERE d.classid = 'pg_proc'::regclass
        AND d.objid = p.oid
        AND d.deptype = 'e'
    )
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: anon исполняет функции public: %', v_left;
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.location_full_path(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.current_role()', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.move_equipment(uuid,uuid,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.move_location(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: у authenticated пропал EXECUTE на путь или RPC';
  END IF;

  IF has_function_privilege('authenticated', 'public.locations_prevent_cycle()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: миграция выдала authenticated триггер цикла';
  END IF;

  RAISE NOTICE 'ok: anon execute revoked';
END;
$$;

BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.location_full_path('55555555-5555-4555-8555-555555555551');
    RAISE EXCEPTION 'FAIL: anon вызвал location_full_path';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM public.effective_responsible_employee_id('55555555-5555-4555-8555-555555555551');
    RAISE EXCEPTION 'FAIL: anon вызвал effective_responsible_employee_id';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  RAISE NOTICE 'ok: anon path functions denied';
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
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_path text;
  v_role public.app_role;
  v_eq uuid;
  v_parent uuid;
BEGIN
  IF public.current_role() <> 'admin' THEN
    RAISE EXCEPTION 'FAIL: current_role() под администратором = %', public.current_role();
  END IF;
  v_role := public.current_role();

  SELECT public.location_full_path('55555555-5555-4555-8555-555555555551')
  INTO v_path;
  IF v_path IS NULL OR v_path = '' THEN
    RAISE EXCEPTION 'FAIL: location_full_path пустой';
  END IF;

  SELECT id INTO v_eq FROM public.equipment WHERE code = 'ROLL-001';
  IF v_eq IS NULL THEN
    RAISE EXCEPTION 'FAIL: нет ROLL-001 для move_equipment';
  END IF;
  PERFORM public.move_equipment(v_eq, '55555555-5555-4555-8555-555555555551', 'проверка anon-revoke');

  PERFORM public.move_location(
    'd1000000-0000-4000-8000-000000000004',
    'd1000000-0000-4000-8000-000000000001'
  );
  SELECT parent_id
  INTO v_parent
  FROM public.locations
  WHERE id = 'd1000000-0000-4000-8000-000000000004';
  IF v_parent <> 'd1000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: move_location не перенёс узел';
  END IF;

  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'FAIL: роль потерялась';
  END IF;

  RAISE NOTICE 'ok: authenticated still calls path and rpc';
END;
$$;
ROLLBACK;

GRANT EXECUTE ON FUNCTION public.location_full_path(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.effective_responsible_employee_id(uuid) TO anon;

\ir ../migrations/20261029121100_revoke_anon_functions.sql

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.location_full_path(uuid)', 'EXECUTE')
    OR has_function_privilege(
      'anon',
      'public.effective_responsible_employee_id(uuid)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'FAIL: повтор миграции оставил EXECUTE у anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.location_full_path(uuid)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.current_role()', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.move_equipment(uuid,uuid,text)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.move_location(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: повтор миграции снял EXECUTE у authenticated';
  END IF;
  RAISE NOTICE 'ok: anon revoke replay';
END;
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;

\ir ../migrations/20261029121100_revoke_anon_functions.sql

CREATE FUNCTION public.anon_default_probe()
RETURNS integer
LANGUAGE sql
AS $$
  SELECT 1;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.anon_default_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: новая функция снова досталась anon';
  END IF;
  RAISE NOTICE 'ok: default privileges без anon';
END;
$$;

DROP FUNCTION public.anon_default_probe();
