-- Архив сотрудников, счётчик поддерева, перенос места и права на новые функции.
-- Повтор миграции снимает случайный GRANT у anon и не ломает GRANT authenticated.

\ir ../migrations/20261029121000_locations_and_responsibles.sql

DO $$
DECLARE
  v_sig text;
  v_callable text[] := ARRAY[
    'public.move_location(uuid,uuid)',
    'public.location_responsible_source(uuid)'
  ];
  v_locked text[] := ARRAY[
    'public.locations_reject_busy_archive()',
    'public.locations_reject_archived_parent()',
    'public.locations_reject_archived_responsible()',
    'public.employees_prevent_referenced_delete()'
  ];
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'move_location',
        'location_responsible_source',
        'locations_reject_busy_archive',
        'locations_reject_archived_parent',
        'locations_reject_archived_responsible',
        'employees_prevent_referenced_delete'
      )
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'FAIL: функция этапа 3 объявлена security definer';
  END IF;

  FOREACH v_sig IN ARRAY v_callable || v_locked LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE')
      OR has_function_privilege('public', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon или PUBLIC может вызвать %', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY v_callable LOOP
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated не может вызвать %', v_sig;
    END IF;
  END LOOP;

  FOREACH v_sig IN ARRAY v_locked LOOP
    IF has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated может вызвать триггер %', v_sig;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('locations_with_path', 'equipment_list', 'employees_directory')
      AND 'security_invoker=true' = ANY (c.reloptions)
    HAVING count(*) = 3
  ) THEN
    RAISE EXCEPTION 'FAIL: представление этапа 3 без security_invoker';
  END IF;

  RAISE NOTICE 'ok: stage3 privileges';
END;
$$;

DO $$
DECLARE
  v_admin uuid := '11111111-1111-4111-8111-111111111111';
  v_plant uuid := 'd1000000-0000-4000-8000-000000000001';
  v_shop uuid := 'd1000000-0000-4000-8000-000000000002';
  v_area uuid := 'd1000000-0000-4000-8000-000000000003';
  v_spare uuid := 'd1000000-0000-4000-8000-000000000004';
  v_ivan uuid := 'd2000000-0000-4000-8000-000000000001';
  v_maria uuid := 'd2000000-0000-4000-8000-000000000002';
  v_free uuid := 'd2000000-0000-4000-8000-000000000003';
  v_fix uuid := '33333333-3333-4333-8333-333333333333';
  v_count bigint;
  v_direct bigint;
  v_children bigint;
  v_inherited boolean;
  v_source uuid;
  v_name text;
  v_parent uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    false
  );

  IF EXISTS (SELECT 1 FROM public.employees WHERE is_archived IS NULL) THEN
    RAISE EXCEPTION 'FAIL: is_archived сотрудника пустой';
  END IF;

  INSERT INTO public.employees (id, full_name, position, phone)
  VALUES
    (v_ivan, 'Иван Этап3', 'Мастер', '+7 900 000-03-01'),
    (v_maria, 'Мария Этап3', 'Метролог', NULL),
    (v_free, 'Свободный Этап3', NULL, NULL);

  INSERT INTO public.locations (id, parent_id, name, kind, responsible_employee_id)
  VALUES
    (v_plant, NULL, 'Завод этап3', 'завод', v_ivan),
    (v_shop, v_plant, 'Цех этап3', 'цех', NULL),
    (v_area, v_shop, 'Участок этап3', 'участок', NULL),
    (v_spare, v_plant, 'Кладовая этап3', 'помещение', NULL);

  SELECT
    equipment_count,
    direct_equipment_count,
    child_count,
    responsible_is_inherited,
    responsible_source_location_id,
    effective_responsible_name
  INTO v_count, v_direct, v_children, v_inherited, v_source, v_name
  FROM public.locations_with_path
  WHERE id = v_shop;

  IF NOT v_inherited OR v_source <> v_plant OR v_name <> 'Иван Этап3' THEN
    RAISE EXCEPTION 'FAIL: цех не унаследовал Ивана (% / % / %)', v_inherited, v_source, v_name;
  END IF;
  IF v_children <> 1 THEN
    RAISE EXCEPTION 'FAIL: у цеха детей %', v_children;
  END IF;

  UPDATE public.locations
  SET responsible_employee_id = v_maria
  WHERE id = v_area;

  SELECT responsible_is_inherited, effective_responsible_name, responsible_source_location_id
  INTO v_inherited, v_name, v_source
  FROM public.locations_with_path
  WHERE id = v_area;

  IF v_inherited OR v_name <> 'Мария Этап3' OR v_source <> v_area THEN
    RAISE EXCEPTION 'FAIL: свой ответственный участка не перекрыл предка';
  END IF;

  IF public.effective_responsible_employee_id(v_shop) <> v_ivan THEN
    RAISE EXCEPTION 'FAIL: старая функция наследования разошлась с представлением';
  END IF;

  INSERT INTO public.equipment (nomenclature_id, location_id)
  VALUES (v_fix, v_shop), (v_fix, v_area);

  SELECT equipment_count, direct_equipment_count
  INTO v_count, v_direct
  FROM public.locations_with_path
  WHERE id = v_plant;
  IF v_count <> 2 OR v_direct <> 0 THEN
    RAISE EXCEPTION 'FAIL: поддерево завода % / прямо %', v_count, v_direct;
  END IF;

  SELECT equipment_count, direct_equipment_count
  INTO v_count, v_direct
  FROM public.locations_with_path
  WHERE id = v_shop;
  IF v_count <> 2 OR v_direct <> 1 THEN
    RAISE EXCEPTION 'FAIL: поддерево цеха % / прямо %', v_count, v_direct;
  END IF;

  SELECT equipment_count INTO v_count
  FROM public.locations_with_path
  WHERE id = v_area;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: участок считает %', v_count;
  END IF;

  BEGIN
    UPDATE public.locations SET is_archived = true WHERE id = v_area;
    RAISE EXCEPTION 'FAIL: архив участка с единицей принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%сначала перенесите единицы%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE public.locations SET is_archived = true WHERE id = v_shop;
    RAISE EXCEPTION 'FAIL: архив цеха с детьми принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%сначала перенесите вложенные места%' THEN
        RAISE;
      END IF;
  END;

  UPDATE public.equipment
  SET location_id = v_plant
  WHERE location_id IN (v_shop, v_area);

  BEGIN
    UPDATE public.locations SET is_archived = true WHERE id = v_shop;
    RAISE EXCEPTION 'FAIL: архив цеха с вложенным участком принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%вложенные места%' THEN
        RAISE;
      END IF;
  END;

  PERFORM public.move_location(v_area, v_plant);
  SELECT parent_id INTO v_parent FROM public.locations WHERE id = v_area;
  IF v_parent <> v_plant THEN
    RAISE EXCEPTION 'FAIL: участок не переехал к заводу';
  END IF;

  UPDATE public.locations SET is_archived = true WHERE id = v_shop;
  IF NOT (SELECT is_archived FROM public.locations WHERE id = v_shop) THEN
    RAISE EXCEPTION 'FAIL: пустой цех не архивировался';
  END IF;

  BEGIN
    PERFORM public.move_location(v_area, v_shop);
    RAISE EXCEPTION 'FAIL: перенос в архивный цех принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%архивного узла%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO public.locations (parent_id, name, kind)
    VALUES (v_shop, 'Внутри архива', 'участок');
    RAISE EXCEPTION 'FAIL: создание внутри архива принято';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%архивного узла%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.move_location(v_plant, v_area);
    RAISE EXCEPTION 'FAIL: цикл через RPC принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%цикл%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.move_location(v_plant, v_plant);
    RAISE EXCEPTION 'FAIL: перенос в себя принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%самого себя%' THEN
        RAISE;
      END IF;
  END;

  PERFORM public.move_location(v_spare, NULL);
  IF (SELECT parent_id FROM public.locations WHERE id = v_spare) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: кладовая не стала корнем';
  END IF;
  IF public.location_full_path(v_spare) <> 'Кладовая этап3' THEN
    RAISE EXCEPTION 'FAIL: путь корня «%»', public.location_full_path(v_spare);
  END IF;

  BEGIN
    DELETE FROM public.employees WHERE id = v_ivan;
    RAISE EXCEPTION 'FAIL: удалили сотрудника со ссылкой';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Архивируйте карточку%' THEN
        RAISE;
      END IF;
  END;

  UPDATE public.employees SET is_archived = true WHERE id = v_ivan;
  IF NOT (SELECT is_archived FROM public.employees WHERE id = v_ivan) THEN
    RAISE EXCEPTION 'FAIL: сотрудник со ссылкой не архивировался';
  END IF;

  SELECT effective_responsible_name, effective_responsible_archived
  INTO v_name, v_inherited
  FROM public.locations_with_path
  WHERE id = v_plant;
  IF v_name <> 'Иван Этап3' OR NOT v_inherited THEN
    RAISE EXCEPTION 'FAIL: архивный Иван пропал с завода';
  END IF;

  BEGIN
    UPDATE public.locations
    SET responsible_employee_id = v_ivan
    WHERE id = v_spare;
    RAISE EXCEPTION 'FAIL: архивного сотрудника назначили';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%архивного сотрудника%' THEN
        RAISE;
      END IF;
  END;

  DELETE FROM public.employees WHERE id = v_free;
  IF EXISTS (SELECT 1 FROM public.employees WHERE id = v_free) THEN
    RAISE EXCEPTION 'FAIL: сотрудник без ссылок не удалился';
  END IF;

  IF (
    SELECT location_count
    FROM public.employees_directory
    WHERE id = v_ivan
  ) <> 1 THEN
    RAISE EXCEPTION 'FAIL: справочник не видит ссылку на Ивана';
  END IF;

  RAISE NOTICE 'ok: stage3 rules';
END;
$$;

-- Администратор под authenticated переносит узел. Редактор и anon — нет.
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
  v_parent uuid;
  v_count bigint;
BEGIN
  IF public.current_role() <> 'admin' THEN
    RAISE EXCEPTION 'FAIL: роль администратора %', public.current_role();
  END IF;
  PERFORM public.move_location(
    'd1000000-0000-4000-8000-000000000004',
    'd1000000-0000-4000-8000-000000000001'
  );
  SELECT parent_id
  INTO v_parent
  FROM public.locations
  WHERE id = 'd1000000-0000-4000-8000-000000000004';
  IF v_parent <> 'd1000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: администратор не перенёс кладовую';
  END IF;

  SELECT equipment_count
  INTO v_count
  FROM public.locations_with_path
  WHERE id = 'd1000000-0000-4000-8000-000000000001';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL: администратор прочитал счётчик %', v_count;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.employees_directory WHERE full_name = 'Иван Этап3') THEN
    RAISE EXCEPTION 'FAIL: администратор не видит справочник сотрудников';
  END IF;

  RAISE NOTICE 'ok: admin move_location';
END;
$$;
ROLLBACK;

BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111112', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111112","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM public.move_location(
      'd1000000-0000-4000-8000-000000000003',
      NULL
    );
    RAISE EXCEPTION 'FAIL: редактор перенёс место';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Недостаточно прав для изменения мест%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.locations_reject_busy_archive();
    RAISE EXCEPTION 'FAIL: редактор вызвал триггер архива';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.locations_with_path
    WHERE id = 'd1000000-0000-4000-8000-000000000002'
      AND responsible_is_inherited
  ) THEN
    RAISE EXCEPTION 'FAIL: редактор не видит наследование';
  END IF;

  RAISE NOTICE 'ok: editor cannot move location';
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.move_location(
      'd1000000-0000-4000-8000-000000000001',
      NULL
    );
    RAISE EXCEPTION 'FAIL: anon вызвал move_location';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM public.location_responsible_source('d1000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'FAIL: anon вызвал location_responsible_source';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.employees_directory;
    RAISE EXCEPTION 'FAIL: anon прочитал employees_directory';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  RAISE NOTICE 'ok: anon stage3 denied';
END;
$$;
ROLLBACK;

-- Повтор миграции забирает EXECUTE у anon, даже если его выдали вручную.
GRANT EXECUTE ON FUNCTION public.move_location(uuid, uuid) TO anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.location_responsible_source(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.locations_reject_busy_archive() TO anon, authenticated;

\ir ../migrations/20261029121000_locations_and_responsibles.sql

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.move_location(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('public', 'public.move_location(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.location_responsible_source(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.locations_reject_busy_archive()', 'EXECUTE')
    OR has_function_privilege('anon', 'public.locations_reject_busy_archive()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: повтор миграции оставил лишний EXECUTE';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.move_location(uuid,uuid)', 'EXECUTE')
    OR NOT has_function_privilege(
      'authenticated',
      'public.location_responsible_source(uuid)',
      'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'FAIL: повтор миграции снял RPC у authenticated';
  END IF;
  RAISE NOTICE 'ok: stage3 migration replay';
END;
$$;
