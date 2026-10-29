-- Журнал, массовые перемещения и статусы.
-- Ошибка на одной единице откатывает пакет. Зритель не меняет. История пишется по каждой.
-- Повтор миграции снимает случайный EXECUTE у anon и PUBLIC и не ломает authenticated.

\ir ../migrations/20261029121200_journal_and_bulk.sql

DO $$
DECLARE
  v_sig text;
  v_callable text[] := ARRAY[
    'public.move_equipment_bulk(uuid[],uuid,text)',
    'public.change_equipment_status_bulk(uuid[],public.equipment_status,text)',
    'public.location_ancestor_ids(uuid)'
  ];
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'move_equipment_bulk',
        'change_equipment_status_bulk',
        'location_ancestor_ids'
      )
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'FAIL: функция этапа 4 объявлена security definer';
  END IF;

  FOREACH v_sig IN ARRAY v_callable LOOP
    IF has_function_privilege('anon', v_sig, 'EXECUTE')
      OR has_function_privilege('public', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon или PUBLIC может вызвать %', v_sig;
    END IF;
    IF NOT has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: authenticated не может вызвать %', v_sig;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('journal_events', 'equipment_status_counts')
      AND 'security_invoker=true' = ANY (c.reloptions)
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'FAIL: представление этапа 4 без security_invoker';
  END IF;

  IF has_table_privilege('anon', 'public.journal_events', 'SELECT')
    OR has_table_privilege('anon', 'public.equipment_status_counts', 'SELECT')
    OR has_table_privilege('public', 'public.journal_events', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon или PUBLIC читает журнал';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.journal_events', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.equipment_status_counts', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: authenticated не читает журнал или сводку';
  END IF;

  RAISE NOTICE 'ok: stage4 privileges';
END;
$$;

CREATE TEMP TABLE stage4_fix (
  key text PRIMARY KEY,
  equipment_id uuid NOT NULL,
  code text NOT NULL
);

GRANT SELECT ON stage4_fix TO authenticated;

DO $$
DECLARE
  v_admin uuid := '11111111-1111-4111-8111-111111111111';
  v_plant uuid := 'e4110000-0000-4000-8000-000000000001';
  v_shop uuid := 'e4110000-0000-4000-8000-000000000002';
  v_area uuid := 'e4110000-0000-4000-8000-000000000003';
  v_other uuid := 'e4110000-0000-4000-8000-000000000004';
  v_out uuid := 'e4110000-0000-4000-8000-000000000005';
  v_nom uuid;
  v_id uuid;
  v_code text;
  v_ancestors uuid[];
  v_count integer;
  v_sum bigint;
  v_scope uuid[];
  v_statuses public.equipment_status[];
  v_kind text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    false
  );

  IF public.current_role() <> 'admin' THEN
    RAISE EXCEPTION 'FAIL: current_role() для подготовки = %', public.current_role();
  END IF;

  v_ancestors := public.location_ancestor_ids(NULL);
  IF v_ancestors IS NULL OR cardinality(v_ancestors) <> 0 THEN
    RAISE EXCEPTION 'FAIL: предки пустого места = %', v_ancestors;
  END IF;

  v_ancestors := public.location_ancestor_ids('e4110000-0000-4000-8000-000000000099');
  IF cardinality(v_ancestors) <> 0 THEN
    RAISE EXCEPTION 'FAIL: предки несуществующего места = %', v_ancestors;
  END IF;

  INSERT INTO public.nomenclature (code_prefix, name)
  VALUES ('BULK', 'Пакет этап4')
  RETURNING id INTO v_nom;

  INSERT INTO public.locations (id, parent_id, name, kind)
  VALUES
    (v_plant, NULL, 'Завод этап4', 'завод'),
    (v_shop, v_plant, 'Цех этап4', 'цех'),
    (v_area, v_shop, 'Участок этап4', 'участок'),
    (v_other, v_plant, 'Склад этап4', 'склад'),
    (v_out, NULL, 'Выезд этап4', 'помещение');

  v_ancestors := public.location_ancestor_ids(v_area);
  IF NOT (
    v_plant = ANY (v_ancestors)
    AND v_shop = ANY (v_ancestors)
    AND v_area = ANY (v_ancestors)
    AND NOT (v_other = ANY (v_ancestors))
    AND NOT (v_out = ANY (v_ancestors))
  ) THEN
    RAISE EXCEPTION 'FAIL: предки участка = %', v_ancestors;
  END IF;

  FOREACH v_kind IN ARRAY ARRAY[
    'ok1', 'ok2', 'move_a', 'move_b', 'stuck', 'status_a', 'status_b', 'dup'
  ] LOOP
    INSERT INTO public.equipment (nomenclature_id, status, location_id)
    VALUES (v_nom, 'in_work', v_area)
    RETURNING id, code INTO v_id, v_code;

    INSERT INTO stage4_fix (key, equipment_id, code)
    VALUES (v_kind, v_id, v_code);
  END LOOP;

  PERFORM public.change_equipment_status(
    (SELECT equipment_id FROM stage4_fix WHERE key = 'ok2'),
    'written_off',
    'списание для пакета'
  );
  PERFORM public.change_equipment_status(
    (SELECT equipment_id FROM stage4_fix WHERE key = 'status_b'),
    'reserve',
    'уже резерв'
  );
  PERFORM public.move_equipment(
    (SELECT equipment_id FROM stage4_fix WHERE key = 'stuck'),
    v_out,
    'уже снаружи'
  );

  SELECT location_scope, status_scope
  INTO v_scope, v_statuses
  FROM public.journal_events
  WHERE equipment_id = (SELECT equipment_id FROM stage4_fix WHERE key = 'ok1')
    AND event_kind = 'movement';

  IF NOT (
    v_plant = ANY (v_scope)
    AND v_shop = ANY (v_scope)
    AND v_area = ANY (v_scope)
    AND NOT (v_other = ANY (v_scope))
  ) THEN
    RAISE EXCEPTION 'FAIL: location_scope создания = %', v_scope;
  END IF;

  IF cardinality(v_statuses) <> 0 THEN
    RAISE EXCEPTION 'FAIL: у перемещения есть статусы %', v_statuses;
  END IF;

  SELECT from_path, to_path
  INTO v_code, v_kind
  FROM public.journal_events
  WHERE equipment_id = (SELECT equipment_id FROM stage4_fix WHERE key = 'ok1')
    AND event_kind = 'movement';

  IF v_code IS NOT NULL OR v_kind <> 'Завод этап4 → Цех этап4 → Участок этап4' THEN
    RAISE EXCEPTION 'FAIL: путь создания «%» → «%»', v_code, v_kind;
  END IF;

  SELECT status_scope
  INTO v_statuses
  FROM public.journal_events
  WHERE equipment_id = (SELECT equipment_id FROM stage4_fix WHERE key = 'ok2')
    AND event_kind = 'status_change'
    AND comment = 'списание для пакета';

  IF NOT ('in_work' = ANY (v_statuses) AND 'written_off' = ANY (v_statuses)) THEN
    RAISE EXCEPTION 'FAIL: status_scope списания = %', v_statuses;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.journal_events
    WHERE equipment_code LIKE 'BULK-%'
      AND event_kind = 'status_change'
      AND cardinality(location_scope) <> 0
  ) THEN
    RAISE EXCEPTION 'FAIL: у смены статуса заполнен location_scope';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.journal_events
  WHERE equipment_code LIKE 'BULK-%'
    AND event_kind = 'movement'
    AND location_scope @> ARRAY[v_plant]::uuid[]
    AND NOT (location_scope @> ARRAY[v_other]::uuid[]);

  IF v_count < 8 THEN
    RAISE EXCEPTION 'FAIL: фильтр завода по поддереву нашёл %', v_count;
  END IF;

  IF (
    SELECT equipment_count
    FROM public.equipment_status_counts
    WHERE status = 'written_off'
  ) <> (
    SELECT count(*) FROM public.equipment WHERE status = 'written_off'
  ) THEN
    RAISE EXCEPTION 'FAIL: сводка written_off не сходится';
  END IF;

  SELECT count(*), COALESCE(sum(equipment_count), 0)
  INTO v_count, v_sum
  FROM public.equipment_status_counts;

  IF v_count <> 5 OR v_sum <> (SELECT count(*) FROM public.equipment) THEN
    RAISE EXCEPTION 'FAIL: сводка статусов % / %', v_count, v_sum;
  END IF;

  RAISE NOTICE 'ok: journal shape';
END;
$$;

-- Редактор успешно переносит пакет, в том числе списанную единицу.
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
  v_editor uuid := '11111111-1111-4111-8111-111111111112';
  v_shop uuid := 'e4110000-0000-4000-8000-000000000002';
  v_area uuid := 'e4110000-0000-4000-8000-000000000003';
  v_rows integer;
  v_moves integer;
  v_from_path text;
  v_to_path text;
  v_name text;
  v_status public.equipment_status;
BEGIN
  IF public.current_role() <> 'editor' THEN
    RAISE EXCEPTION 'FAIL: роль редактора %', public.current_role();
  END IF;

  SELECT count(*)
  INTO v_rows
  FROM public.move_equipment_bulk(
    ARRAY[
      (SELECT equipment_id FROM stage4_fix WHERE key = 'ok1'),
      (SELECT equipment_id FROM stage4_fix WHERE key = 'ok2')
    ],
    v_shop,
    '  пакет-ок  '
  );

  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'FAIL: пакет вернул % строк', v_rows;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.equipment
    WHERE id IN (
      SELECT equipment_id FROM stage4_fix WHERE key IN ('ok1', 'ok2')
    )
      AND location_id IS DISTINCT FROM v_shop
  ) THEN
    RAISE EXCEPTION 'FAIL: пакет не перенёс обе единицы в цех';
  END IF;

  SELECT status
  INTO v_status
  FROM public.equipment
  WHERE id = (SELECT equipment_id FROM stage4_fix WHERE key = 'ok2');

  IF v_status <> 'written_off' THEN
    RAISE EXCEPTION 'FAIL: списанная единица сменила статус на %', v_status;
  END IF;

  SELECT count(*)
  INTO v_moves
  FROM public.movements
  WHERE comment = 'пакет-ок';

  IF v_moves <> 2 OR EXISTS (
    SELECT 1
    FROM public.movements
    WHERE comment = 'пакет-ок'
      AND (
        moved_by IS DISTINCT FROM v_editor
        OR from_location_id IS DISTINCT FROM v_area
        OR to_location_id IS DISTINCT FROM v_shop
      )
  ) THEN
    RAISE EXCEPTION 'FAIL: история пакета % записей, автор или места не те', v_moves;
  END IF;

  SELECT from_path, to_path, actor_name
  INTO v_from_path, v_to_path, v_name
  FROM public.journal_events
  WHERE comment = 'пакет-ок'
    AND equipment_id = (SELECT equipment_id FROM stage4_fix WHERE key = 'ok1');

  IF v_from_path <> 'Завод этап4 → Цех этап4 → Участок этап4'
    OR v_to_path <> 'Завод этап4 → Цех этап4'
    OR v_name <> 'Редактор' THEN
    RAISE EXCEPTION 'FAIL: лента пакета «%» → «%» / %', v_from_path, v_to_path, v_name;
  END IF;

  RAISE NOTICE 'ok: bulk move';
END;
$$;
COMMIT;

-- Ошибка на одной единице откатывает перемещение всего пакета.
DO $$
DECLARE
  v_editor uuid := '11111111-1111-4111-8111-111111111112';
  v_area uuid := 'e4110000-0000-4000-8000-000000000003';
  v_out uuid := 'e4110000-0000-4000-8000-000000000005';
  v_stuck uuid;
  v_stuck_code text;
  v_before integer;
  v_after integer;
  v_location uuid;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_editor::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_editor::text, 'role', 'authenticated')::text,
    false
  );

  SELECT equipment_id, code
  INTO v_stuck, v_stuck_code
  FROM stage4_fix
  WHERE key = 'stuck';

  SELECT count(*)
  INTO v_before
  FROM public.movements
  WHERE equipment_id IN (
    SELECT equipment_id FROM stage4_fix WHERE key IN ('move_a', 'move_b', 'stuck')
  );

  BEGIN
    PERFORM public.move_equipment_bulk(
      ARRAY[
        (SELECT equipment_id FROM stage4_fix WHERE key = 'move_a'),
        (SELECT equipment_id FROM stage4_fix WHERE key = 'move_b'),
        v_stuck
      ],
      v_out,
      'пакет-сбой'
    );
    RAISE EXCEPTION 'FAIL: пакет с уже стоящей единицей принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE format('%%Место не изменилось у %s%%', v_stuck_code) THEN
        RAISE;
      END IF;
  END;

  SELECT count(*)
  INTO v_after
  FROM public.movements
  WHERE equipment_id IN (
    SELECT equipment_id FROM stage4_fix WHERE key IN ('move_a', 'move_b', 'stuck')
  );

  IF v_after <> v_before OR EXISTS (
    SELECT 1 FROM public.movements WHERE comment = 'пакет-сбой'
  ) THEN
    RAISE EXCEPTION 'FAIL: сбойный пакет оставил историю % → %', v_before, v_after;
  END IF;

  SELECT location_id
  INTO v_location
  FROM public.equipment
  WHERE id = (SELECT equipment_id FROM stage4_fix WHERE key = 'move_a');

  IF v_location IS DISTINCT FROM v_area THEN
    RAISE EXCEPTION 'FAIL: откат не вернул move_a, место %', v_location;
  END IF;

  SELECT location_id
  INTO v_location
  FROM public.equipment
  WHERE id = v_stuck;

  IF v_location IS DISTINCT FROM v_out THEN
    RAISE EXCEPTION 'FAIL: откат сдвинул stuck, место %', v_location;
  END IF;

  RAISE NOTICE 'ok: bulk move rollback';
END;
$$;

-- Смена статуса пакетом и откат, если у одной единицы статус уже такой.
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
  v_editor uuid := '11111111-1111-4111-8111-111111111112';
  v_rows integer;
  v_changes integer;
  v_status public.equipment_status;
  v_before integer;
  v_code text;
BEGIN
  SELECT count(*)
  INTO v_rows
  FROM public.change_equipment_status_bulk(
    ARRAY[
      (SELECT equipment_id FROM stage4_fix WHERE key = 'status_a'),
      (SELECT equipment_id FROM stage4_fix WHERE key = 'move_a')
    ],
    'in_repair',
    'статус-ок'
  );

  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'FAIL: пакет статуса вернул %', v_rows;
  END IF;

  SELECT count(*)
  INTO v_changes
  FROM public.status_changes
  WHERE comment = 'статус-ок';

  IF v_changes <> 2 OR EXISTS (
    SELECT 1
    FROM public.status_changes
    WHERE comment = 'статус-ок'
      AND (
        changed_by IS DISTINCT FROM v_editor
        OR from_status IS DISTINCT FROM 'in_work'
        OR to_status IS DISTINCT FROM 'in_repair'
      )
  ) THEN
    RAISE EXCEPTION 'FAIL: история статуса % записей, автор или статусы не те', v_changes;
  END IF;

  SELECT code
  INTO v_code
  FROM stage4_fix
  WHERE key = 'status_b';

  SELECT count(*)
  INTO v_before
  FROM public.status_changes
  WHERE equipment_id IN (
    SELECT equipment_id FROM stage4_fix WHERE key IN ('status_a', 'status_b')
  );

  BEGIN
    PERFORM public.change_equipment_status_bulk(
      ARRAY[
        (SELECT equipment_id FROM stage4_fix WHERE key = 'status_a'),
        (SELECT equipment_id FROM stage4_fix WHERE key = 'status_b')
      ],
      'reserve',
      'статус-сбой'
    );
    RAISE EXCEPTION 'FAIL: пакет со старым статусом принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE format('%%Статус не изменился у %s%%', v_code) THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.status_changes WHERE comment = 'статус-сбой') THEN
    RAISE EXCEPTION 'FAIL: сбойный пакет статуса оставил историю';
  END IF;

  IF (
    SELECT count(*)
    FROM public.status_changes
    WHERE equipment_id IN (
      SELECT equipment_id FROM stage4_fix WHERE key IN ('status_a', 'status_b')
    )
  ) <> v_before THEN
    RAISE EXCEPTION 'FAIL: число смен статуса изменилось после отката';
  END IF;

  SELECT status
  INTO v_status
  FROM public.equipment
  WHERE id = (SELECT equipment_id FROM stage4_fix WHERE key = 'status_a');

  IF v_status <> 'in_repair' THEN
    RAISE EXCEPTION 'FAIL: откат сменил status_a на %', v_status;
  END IF;

  SELECT status
  INTO v_status
  FROM public.equipment
  WHERE id = (SELECT equipment_id FROM stage4_fix WHERE key = 'status_b');

  IF v_status <> 'reserve' THEN
    RAISE EXCEPTION 'FAIL: откат сменил status_b на %', v_status;
  END IF;

  RAISE NOTICE 'ok: bulk status';
END;
$$;
COMMIT;

-- Пустой список, пустой идентификатор, чужая единица, дубль и потолок пакета.
DO $$
DECLARE
  v_editor uuid := '11111111-1111-4111-8111-111111111112';
  v_shop uuid := 'e4110000-0000-4000-8000-000000000002';
  v_area uuid := 'e4110000-0000-4000-8000-000000000003';
  v_dup uuid;
  v_before integer;
  v_moves integer;
  v_location uuid;
  v_ids uuid[];
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_editor::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_editor::text, 'role', 'authenticated')::text,
    false
  );

  SELECT equipment_id
  INTO v_dup
  FROM stage4_fix
  WHERE key = 'dup';

  BEGIN
    PERFORM public.move_equipment_bulk(ARRAY[]::uuid[], v_shop, 'пусто');
    RAISE EXCEPTION 'FAIL: пустой пакет принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Выберите хотя бы одну единицу%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.change_equipment_status_bulk(NULL, 'reserve', 'пусто');
    RAISE EXCEPTION 'FAIL: пустой пакет статуса принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Выберите хотя бы одну единицу%' THEN
        RAISE;
      END IF;
  END;

  SELECT location_id, (
    SELECT count(*) FROM public.movements WHERE equipment_id = v_dup
  )
  INTO v_location, v_before
  FROM public.equipment
  WHERE id = v_dup;

  BEGIN
    PERFORM public.move_equipment_bulk(ARRAY[v_dup, NULL], v_shop, 'дыра');
    RAISE EXCEPTION 'FAIL: пакет с пустым id принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%пустой идентификатор%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.move_equipment_bulk(
      ARRAY[v_dup, 'e4110000-0000-4000-8000-0000000000aa'],
      v_shop,
      'чужая'
    );
    RAISE EXCEPTION 'FAIL: пакет с чужой единицей принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%не найдена%' THEN
        RAISE;
      END IF;
  END;

  IF (SELECT location_id FROM public.equipment WHERE id = v_dup) IS DISTINCT FROM v_location
    OR (SELECT count(*) FROM public.movements WHERE equipment_id = v_dup) <> v_before
    OR EXISTS (SELECT 1 FROM public.movements WHERE comment IN ('дыра', 'чужая', 'пусто')) THEN
    RAISE EXCEPTION 'FAIL: отклонённый пакет изменил единицу';
  END IF;

  SELECT array_agg(gen_random_uuid())
  INTO v_ids
  FROM generate_series(1, 201);

  BEGIN
    PERFORM public.move_equipment_bulk(v_ids, v_shop, 'много');
    RAISE EXCEPTION 'FAIL: пакет больше 200 принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%не больше 200%' THEN
        RAISE;
      END IF;
  END;

  PERFORM public.move_equipment_bulk(ARRAY[v_dup, v_dup], v_shop, 'дубль');

  SELECT count(*)
  INTO v_moves
  FROM public.movements
  WHERE equipment_id = v_dup
    AND comment = 'дубль';

  IF v_moves <> 1 OR (
    SELECT location_id FROM public.equipment WHERE id = v_dup
  ) IS DISTINCT FROM v_shop THEN
    RAISE EXCEPTION 'FAIL: дубль id записал % перемещений, место не цех', v_moves;
  END IF;

  IF (SELECT location_id FROM public.equipment WHERE id = v_dup) = v_area THEN
    RAISE EXCEPTION 'FAIL: дубль не перенёс единицу';
  END IF;

  RAISE NOTICE 'ok: bulk guards';
END;
$$;

-- Зритель вызывает функцию, но строки не меняет.
BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111113', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111113","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_shop uuid := 'e4110000-0000-4000-8000-000000000002';
  v_id uuid;
  v_location uuid;
  v_status public.equipment_status;
  v_moves integer;
  v_journal integer;
BEGIN
  IF public.current_role() <> 'viewer' THEN
    RAISE EXCEPTION 'FAIL: роль зрителя %', public.current_role();
  END IF;

  SELECT equipment_id
  INTO v_id
  FROM stage4_fix
  WHERE key = 'move_b';

  SELECT location_id, status
  INTO v_location, v_status
  FROM public.equipment
  WHERE id = v_id;

  SELECT count(*)
  INTO v_moves
  FROM public.movements
  WHERE equipment_id = v_id;

  BEGIN
    PERFORM public.move_equipment_bulk(ARRAY[v_id], v_shop, 'зритель');
    RAISE EXCEPTION 'FAIL: зритель переместил пакет';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Недостаточно прав%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.change_equipment_status_bulk(ARRAY[v_id], 'reserve', 'зритель');
    RAISE EXCEPTION 'FAIL: зритель сменил статус пакетом';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Недостаточно прав%' THEN
        RAISE;
      END IF;
  END;

  IF (SELECT location_id FROM public.equipment WHERE id = v_id) IS DISTINCT FROM v_location
    OR (SELECT status FROM public.equipment WHERE id = v_id) IS DISTINCT FROM v_status
    OR (SELECT count(*) FROM public.movements WHERE equipment_id = v_id) <> v_moves
    OR EXISTS (SELECT 1 FROM public.movements WHERE comment = 'зритель')
    OR EXISTS (SELECT 1 FROM public.status_changes WHERE comment = 'зритель') THEN
    RAISE EXCEPTION 'FAIL: отказ зрителю что-то записал';
  END IF;

  SELECT count(*)
  INTO v_journal
  FROM public.journal_events
  WHERE equipment_code LIKE 'BULK-%';

  IF v_journal = 0 THEN
    RAISE EXCEPTION 'FAIL: зритель не видит журнал';
  END IF;

  IF (
    SELECT COALESCE(sum(equipment_count), 0)
    FROM public.equipment_status_counts
  ) = 0 THEN
    RAISE EXCEPTION 'FAIL: зритель не видит сводку';
  END IF;

  RAISE NOTICE 'ok: viewer bulk denied';
END;
$$;
ROLLBACK;

-- anon не вызывает новые функции и не читает представления.
BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.move_equipment_bulk(ARRAY[]::uuid[], NULL, NULL);
    RAISE EXCEPTION 'FAIL: anon вызвал move_equipment_bulk';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM public.change_equipment_status_bulk(ARRAY[]::uuid[], 'in_work', NULL);
    RAISE EXCEPTION 'FAIL: anon вызвал change_equipment_status_bulk';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM public.location_ancestor_ids(NULL);
    RAISE EXCEPTION 'FAIL: anon вызвал location_ancestor_ids';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM count(*) FROM public.journal_events;
    RAISE EXCEPTION 'FAIL: anon прочитал journal_events';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    PERFORM count(*) FROM public.equipment_status_counts;
    RAISE EXCEPTION 'FAIL: anon прочитал equipment_status_counts';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  RAISE NOTICE 'ok: anon stage4 denied';
END;
$$;
ROLLBACK;

-- Отключённый пользователь не видит ленту и сводку.
BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111114', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111114","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_count integer;
  v_sum bigint;
BEGIN
  SELECT count(*)
  INTO v_count
  FROM public.journal_events;

  SELECT COALESCE(sum(equipment_count), 0)
  INTO v_sum
  FROM public.equipment_status_counts;

  IF v_count <> 0 OR v_sum <> 0 THEN
    RAISE EXCEPTION 'FAIL: отключённый видит журнал % или сводку %', v_count, v_sum;
  END IF;

  RAISE NOTICE 'ok: inactive journal';
END;
$$;
ROLLBACK;

-- Администратор тоже проводит пакет.
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
  v_admin uuid := '11111111-1111-4111-8111-111111111111';
  v_actor uuid;
  v_status public.equipment_status;
BEGIN
  PERFORM public.change_equipment_status_bulk(
    ARRAY[(SELECT equipment_id FROM stage4_fix WHERE key = 'stuck')],
    'reserve',
    'админ-пакет'
  );

  SELECT changed_by
  INTO v_actor
  FROM public.status_changes
  WHERE comment = 'админ-пакет';

  SELECT status
  INTO v_status
  FROM public.equipment
  WHERE id = (SELECT equipment_id FROM stage4_fix WHERE key = 'stuck');

  IF v_actor <> v_admin OR v_status <> 'reserve' THEN
    RAISE EXCEPTION 'FAIL: пакет администратора автор % статус %', v_actor, v_status;
  END IF;

  RAISE NOTICE 'ok: admin bulk';
END;
$$;
COMMIT;

GRANT EXECUTE ON FUNCTION public.move_equipment_bulk(uuid[], uuid, text) TO anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.change_equipment_status_bulk(uuid[], public.equipment_status, text) TO anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.location_ancestor_ids(uuid) TO anon, PUBLIC;
GRANT SELECT ON public.journal_events TO anon, PUBLIC;
GRANT SELECT ON public.equipment_status_counts TO anon;

\ir ../migrations/20261029121200_journal_and_bulk.sql

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.move_equipment_bulk(uuid[],uuid,text)', 'EXECUTE')
    OR has_function_privilege('public', 'public.move_equipment_bulk(uuid[],uuid,text)', 'EXECUTE')
    OR has_function_privilege(
      'anon',
      'public.change_equipment_status_bulk(uuid[],public.equipment_status,text)',
      'EXECUTE'
    )
    OR has_function_privilege('anon', 'public.location_ancestor_ids(uuid)', 'EXECUTE')
    OR has_function_privilege('public', 'public.location_ancestor_ids(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: повтор миграции оставил EXECUTE у anon или PUBLIC';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.move_equipment_bulk(uuid[],uuid,text)', 'EXECUTE')
    OR NOT has_function_privilege(
      'authenticated',
      'public.change_equipment_status_bulk(uuid[],public.equipment_status,text)',
      'EXECUTE'
    )
    OR NOT has_function_privilege('authenticated', 'public.location_ancestor_ids(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: повтор миграции снял EXECUTE у authenticated';
  END IF;

  IF has_table_privilege('anon', 'public.journal_events', 'SELECT')
    OR has_table_privilege('public', 'public.journal_events', 'SELECT')
    OR has_table_privilege('anon', 'public.equipment_status_counts', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: повтор миграции оставил чтение журнала anon';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.journal_events', 'SELECT')
    OR NOT EXISTS (
      SELECT 1
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'journal_events'
        AND 'security_invoker=true' = ANY (c.reloptions)
    ) THEN
    RAISE EXCEPTION 'FAIL: повтор миграции сломал журнал';
  END IF;

  RAISE NOTICE 'ok: stage4 migration replay';
END;
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;

\ir ../migrations/20261029121200_journal_and_bulk.sql

CREATE FUNCTION public.stage4_anon_probe()
RETURNS integer
LANGUAGE sql
SET search_path = public
AS $$
  SELECT 1;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.stage4_anon_probe()', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: новая функция после этапа 4 снова досталась anon';
  END IF;
  IF NOT has_function_privilege(
    'authenticated',
    'public.move_equipment_bulk(uuid[],uuid,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'FAIL: после повтора у authenticated нет пакетного перемещения';
  END IF;
  RAISE NOTICE 'ok: stage4 default privileges';
END;
$$;

DROP FUNCTION public.stage4_anon_probe();
