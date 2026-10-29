-- Этап 6: график поверок, бакет свидетельств, атомарный импорт.
-- Повтор миграций не возвращает EXECUTE роли anon и не плодит политики.

\ir ../migrations/20261029121300_verification_queue.sql
\ir ../migrations/20261029121400_verification_certificates.sql
\ir ../migrations/20261029121500_excel_import.sql

DO $$
DECLARE
  v_sig text;
  v_callable text[] := ARRAY[
    'public.verification_summary(integer)',
    'public.excel_import_guard(jsonb)',
    'public.fold_text(text)',
    'public.import_nomenclature(jsonb)',
    'public.import_locations(jsonb)',
    'public.import_employees(jsonb)',
    'public.import_equipment(jsonb)'
  ];
  v_policies integer;
BEGIN
  IF public.fold_text('В Работе') <> 'в работе' OR public.fold_text('Ёж') <> 'ёж' THEN
    RAISE EXCEPTION 'FAIL: fold_text не складывает кириллицу';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'verification_summary',
        'excel_import_guard',
        'fold_text',
        'import_nomenclature',
        'import_locations',
        'import_employees',
        'import_equipment'
      )
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'FAIL: функция этапа 6 объявлена security definer';
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
      AND c.relname IN ('equipment_verification_queue', 'verification_journal')
      AND 'security_invoker=true' = ANY (c.reloptions)
    HAVING count(*) = 2
  ) THEN
    RAISE EXCEPTION 'FAIL: представление этапа 6 без security_invoker';
  END IF;

  IF has_table_privilege('anon', 'public.equipment_verification_queue', 'SELECT')
    OR has_table_privilege('anon', 'public.verification_journal', 'SELECT')
    OR has_table_privilege('public', 'public.equipment_verification_queue', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon или PUBLIC читает очередь поверок';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.equipment_verification_queue', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.verification_journal', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: authenticated не читает очередь поверок';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'verification-certificates'
      AND public = false
      AND file_size_limit = 10485760
      AND allowed_mime_types @> ARRAY['application/pdf', 'image/jpeg']::text[]
  ) THEN
    RAISE EXCEPTION 'FAIL: бакет свидетельств не приватный или без ограничений';
  END IF;

  SELECT count(*)
  INTO v_policies
  FROM pg_policy
  WHERE polrelid = 'storage.objects'::regclass
    AND polname LIKE 'verification_certificates_%';

  IF v_policies <> 4 THEN
    RAISE EXCEPTION 'FAIL: политик storage %, ожидалось 4', v_policies;
  END IF;

  RAISE NOTICE 'ok: stage6 privileges';
END;
$$;

-- Сводка: списанные не входят, порог двигает границу «скоро».
DO $$
DECLARE
  v_admin uuid := '11111111-1111-4111-8111-111111111111';
  v_nom uuid;
  v_before record;
  v_after record;
  v_tight record;
  v_zero record;
  v_code text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    false
  );

  SELECT overdue, soon, ok, no_data
  INTO v_before
  FROM public.verification_summary(30);

  INSERT INTO public.nomenclature (code_prefix, name, requires_verification, verification_interval_months)
  VALUES ('SUMQ', 'Сводка поверок', true, 12)
  RETURNING id INTO v_nom;

  INSERT INTO public.equipment (nomenclature_id, status, location_id, next_verification_date)
  VALUES
    (v_nom, 'in_work', '55555555-5555-4555-8555-555555555551', CURRENT_DATE - 1),
    (v_nom, 'in_work', '55555555-5555-4555-8555-555555555551', CURRENT_DATE),
    (v_nom, 'in_work', '55555555-5555-4555-8555-555555555551', CURRENT_DATE + 10),
    (v_nom, 'in_work', '55555555-5555-4555-8555-555555555551', CURRENT_DATE + 40),
    (v_nom, 'reserve', '55555555-5555-4555-8555-555555555551', NULL);

  INSERT INTO public.equipment (nomenclature_id, status, location_id, next_verification_date)
  VALUES (v_nom, 'written_off', '55555555-5555-4555-8555-555555555551', CURRENT_DATE - 1)
  RETURNING code INTO v_code;

  SELECT overdue, soon, ok, no_data
  INTO v_after
  FROM public.verification_summary(30);

  IF v_after.overdue <> v_before.overdue + 1
    OR v_after.soon <> v_before.soon + 2
    OR v_after.ok <> v_before.ok + 1
    OR v_after.no_data <> v_before.no_data + 1 THEN
    RAISE EXCEPTION 'FAIL: сводка 30 дней % / было %', v_after, v_before;
  END IF;

  SELECT overdue, soon, ok, no_data
  INTO v_tight
  FROM public.verification_summary(5);

  IF v_tight.overdue <> v_before.overdue + 1
    OR v_tight.soon <> v_before.soon + 1
    OR v_tight.ok <> v_before.ok + 2
    OR v_tight.no_data <> v_before.no_data + 1 THEN
    RAISE EXCEPTION 'FAIL: сводка 5 дней %', v_tight;
  END IF;

  SELECT overdue, soon, ok, no_data
  INTO v_zero
  FROM public.verification_summary(0);

  IF v_zero.soon <> v_before.soon + 1 OR v_zero.ok <> v_before.ok + 2 THEN
    RAISE EXCEPTION 'FAIL: сводка 0 дней %', v_zero;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.equipment_verification_queue
    WHERE code = v_code
      AND status = 'written_off'
  ) THEN
    RAISE EXCEPTION 'FAIL: очередь не показывает списанную единицу';
  END IF;

  BEGIN
    PERFORM public.verification_summary(-1);
    RAISE EXCEPTION 'FAIL: отрицательный порог принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Порог%' THEN
        RAISE;
      END IF;
  END;

  RAISE NOTICE 'ok: verification summary';
END;
$$;

-- Зритель читает очередь и журнал, не пишет поверку. Редактор пишет.
-- Отключённый не видит сводку. anon не вызывает функцию.
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
  v_count integer;
  v_eq uuid;
BEGIN
  IF public.current_role() <> 'viewer' THEN
    RAISE EXCEPTION 'FAIL: роль зрителя %', public.current_role();
  END IF;

  SELECT count(*) INTO v_count FROM public.equipment_verification_queue;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'FAIL: зритель не видит очередь поверок';
  END IF;

  SELECT count(*) INTO v_count FROM public.verification_summary(30);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: зритель не получил сводку';
  END IF;

  SELECT id INTO v_eq
  FROM public.equipment_verification_queue
  WHERE status <> 'written_off'
  LIMIT 1;

  BEGIN
    INSERT INTO public.verifications (equipment_id, verified_at, result)
    VALUES (v_eq, now(), 'passed');
    RAISE EXCEPTION 'FAIL: зритель записал поверку';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  RAISE NOTICE 'ok: viewer verifications';
END;
$$;
ROLLBACK;

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
  v_row record;
  v_count integer;
BEGIN
  SELECT overdue, soon, ok, no_data
  INTO v_row
  FROM public.verification_summary(30);

  IF v_row.overdue <> 0 OR v_row.soon <> 0 OR v_row.ok <> 0 OR v_row.no_data <> 0 THEN
    RAISE EXCEPTION 'FAIL: отключённый видит сводку %', v_row;
  END IF;

  SELECT count(*) INTO v_count FROM public.equipment_verification_queue;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: отключённый видит очередь';
  END IF;

  RAISE NOTICE 'ok: inactive verification summary';
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM public.verification_summary(30);
    RAISE EXCEPTION 'FAIL: anon вызвал verification_summary';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM public.import_equipment('[]'::jsonb);
    RAISE EXCEPTION 'FAIL: anon вызвал import_equipment';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.equipment_verification_queue;
    RAISE EXCEPTION 'FAIL: anon прочитал очередь';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  RAISE NOTICE 'ok: anon stage6 denied';
END;
$$;
ROLLBACK;

-- Редактор добавляет поверку и файл свидетельства. Зритель файл только читает.
DO $$
DECLARE
  v_admin uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '11111111-1111-4111-8111-111111111112';
  v_nom uuid;
  v_eq uuid;
  v_next date;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    false
  );

  INSERT INTO public.nomenclature (code_prefix, name, requires_verification, verification_interval_months)
  VALUES ('VEDT', 'Поверка редактора', true, 6)
  RETURNING id INTO v_nom;

  INSERT INTO public.equipment (nomenclature_id, status, location_id)
  VALUES (v_nom, 'on_verification', '55555555-5555-4555-8555-555555555551')
  RETURNING id INTO v_eq;

  PERFORM set_config('request.jwt.claim.sub', v_editor::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_editor::text, 'role', 'authenticated')::text,
    false
  );

  INSERT INTO public.verifications (equipment_id, verified_at, result, next_due_at, certificate_number)
  VALUES (v_eq, timestamptz '2026-10-01 12:00:00+00', 'passed', date '2027-04-01', 'СП-РЕД');

  SELECT next_verification_date
  INTO v_next
  FROM public.equipment
  WHERE id = v_eq;

  IF v_next <> date '2027-04-01' THEN
    RAISE EXCEPTION 'FAIL: редактор не обновил следующую поверку, сейчас %', v_next;
  END IF;

  RAISE NOTICE 'ok: editor verification';
END;
$$;

BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111112', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111112","role":"authenticated"}',
  true
);
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects (bucket_id, name)
VALUES ('verification-certificates', 'stage6/editor.pdf');
DO $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)
  INTO v_count
  FROM storage.objects
  WHERE bucket_id = 'verification-certificates'
    AND name = 'stage6/editor.pdf';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: редактор не записал свидетельство';
  END IF;
  UPDATE storage.objects
  SET metadata = '{"ok":true}'::jsonb
  WHERE bucket_id = 'verification-certificates'
    AND name = 'stage6/editor.pdf';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: редактор не обновил свидетельство';
  END IF;
  RAISE NOTICE 'ok: editor storage write';
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
INSERT INTO storage.objects (bucket_id, name)
VALUES ('verification-certificates', 'stage6/admin.pdf');
COMMIT;

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
  v_count integer;
BEGIN
  SELECT count(*)
  INTO v_count
  FROM storage.objects
  WHERE name = 'stage6/admin.pdf';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: зритель не прочитал свидетельство';
  END IF;

  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('verification-certificates', 'stage6/viewer.pdf');
    RAISE EXCEPTION 'FAIL: зритель записал свидетельство';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  DELETE FROM storage.objects WHERE name = 'stage6/admin.pdf';
  IF FOUND THEN
    RAISE EXCEPTION 'FAIL: зритель удалил свидетельство';
  END IF;

  RAISE NOTICE 'ok: viewer storage read';
END;
$$;
ROLLBACK;

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
BEGIN
  SELECT count(*)
  INTO v_count
  FROM storage.objects
  WHERE bucket_id = 'verification-certificates';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: отключённый видит % файлов', v_count;
  END IF;
  RAISE NOTICE 'ok: inactive storage';
END;
$$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM 1 FROM storage.objects WHERE bucket_id = 'verification-certificates';
    RAISE EXCEPTION 'FAIL: anon прочитал storage.objects';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  RAISE NOTICE 'ok: anon storage denied';
END;
$$;
ROLLBACK;

-- Импорт: коды выдаёт база, ошибка откатывает файл, роли, потолок строк.
DO $$
DECLARE
  v_admin uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '11111111-1111-4111-8111-111111111112';
  v_viewer uuid := '11111111-1111-4111-8111-111111111113';
  v_result jsonb;
  v_count integer;
  v_last integer;
  v_path text;
  v_employee uuid;
  v_responsible uuid;
  v_payload jsonb;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    false
  );

  BEGIN
    PERFORM public.import_nomenclature(jsonb_build_array(
      jsonb_build_object('row', 2, 'code_prefix', 'ATOM', 'name', 'Первая', 'requires_verification', false),
      jsonb_build_object('row', 3, 'code_prefix', 'ATOM', 'name', 'Вторая', 'requires_verification', false)
    ));
    RAISE EXCEPTION 'FAIL: дубль префикса принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%уже занят%' THEN
        RAISE;
      END IF;
  END;

  SELECT count(*) INTO v_count FROM public.nomenclature WHERE code_prefix = 'ATOM';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: атомарность номенклатуры, осталось %', v_count;
  END IF;
  IF EXISTS (SELECT 1 FROM public.code_counters WHERE prefix = 'ATOM') THEN
    RAISE EXCEPTION 'FAIL: счётчик ATOM остался после отката';
  END IF;

  v_result := public.import_nomenclature(jsonb_build_array(
    jsonb_build_object(
      'row', 2,
      'code_prefix', 'impt',
      'name', 'Импорт без поверки',
      'requires_verification', false
    ),
    jsonb_build_object(
      'row', 3,
      'code_prefix', 'SCAL2',
      'name', 'Импорт с поверкой',
      'requires_verification', true,
      'verification_interval_months', 12
    )
  ));
  IF (v_result->>'created')::integer <> 2 THEN
    RAISE EXCEPTION 'FAIL: создано номенклатуры %', v_result;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.nomenclature WHERE code_prefix = 'IMPT' AND requires_verification = false
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.nomenclature
    WHERE code_prefix = 'SCAL2'
      AND requires_verification
      AND verification_interval_months = 12
  ) THEN
    RAISE EXCEPTION 'FAIL: префикс не приведён или интервал не записан';
  END IF;

  INSERT INTO public.employees (full_name)
  VALUES ('Пётр Импортов')
  RETURNING id INTO v_employee;

  v_result := public.import_locations(jsonb_build_array(
    jsonb_build_object(
      'row', 4,
      'name', 'Участок Импорт',
      'kind', 'участок',
      'parent_path', 'Завод Импорт -> Цех Импорт',
      'responsible_name', ''
    ),
    jsonb_build_object(
      'row', 2,
      'name', 'Завод Импорт',
      'kind', 'завод',
      'parent_path', '',
      'responsible_name', 'пётр импортов'
    ),
    jsonb_build_object(
      'row', 3,
      'name', 'Цех Импорт',
      'kind', 'цех',
      'parent_path', 'Завод Импорт',
      'responsible_name', ''
    )
  ));
  IF (v_result->>'created')::integer <> 3 THEN
    RAISE EXCEPTION 'FAIL: создано мест %', v_result;
  END IF;

  SELECT public.location_full_path(id)
  INTO v_path
  FROM public.locations
  WHERE name = 'Участок Импорт';
  IF v_path <> 'Завод Импорт → Цех Импорт → Участок Импорт' THEN
    RAISE EXCEPTION 'FAIL: путь импорта «%»', v_path;
  END IF;

  SELECT responsible_employee_id
  INTO v_responsible
  FROM public.locations
  WHERE name = 'Завод Импорт';
  IF v_responsible IS DISTINCT FROM v_employee THEN
    RAISE EXCEPTION 'FAIL: ответственный импорта не сопоставлен';
  END IF;

  BEGIN
    PERFORM public.import_locations(jsonb_build_array(
      jsonb_build_object('row', 2, 'name', 'Завод Откат', 'kind', 'завод', 'parent_path', '', 'responsible_name', ''),
      jsonb_build_object(
        'row', 3,
        'name', 'Участок без родителя',
        'kind', 'участок',
        'parent_path', 'Нет такого пути',
        'responsible_name', ''
      )
    ));
    RAISE EXCEPTION 'FAIL: место без родителя принято';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%не найден%' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.locations WHERE name = 'Завод Откат') THEN
    RAISE EXCEPTION 'FAIL: откат не убрал завод, созданный раньше ошибочной строки';
  END IF;

  BEGIN
    PERFORM public.import_locations(jsonb_build_array(
      jsonb_build_object('row', 2, 'name', 'Дубль Места', 'kind', 'завод', 'parent_path', '', 'responsible_name', ''),
      jsonb_build_object('row', 3, 'name', 'Дубль Места', 'kind', 'цех', 'parent_path', '', 'responsible_name', '')
    ));
    RAISE EXCEPTION 'FAIL: дубль пути места принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%уже есть%' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.locations WHERE name = 'Дубль Места') THEN
    RAISE EXCEPTION 'FAIL: дубль пути места не откатился';
  END IF;

  INSERT INTO public.employees (full_name) VALUES ('Двойной Имя'), ('Двойной Имя');
  BEGIN
    PERFORM public.import_locations(jsonb_build_array(
      jsonb_build_object('row', 2, 'name', 'Завод Двойной', 'kind', 'завод', 'parent_path', '', 'responsible_name', ''),
      jsonb_build_object(
        'row', 3,
        'name', 'Цех Двойной',
        'kind', 'цех',
        'parent_path', 'Завод Двойной',
        'responsible_name', 'Двойной Имя'
      )
    ));
    RAISE EXCEPTION 'FAIL: неоднозначное ФИО принято';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%несколько сотрудников%' THEN
        RAISE;
      END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.locations WHERE name = 'Завод Двойной') THEN
    RAISE EXCEPTION 'FAIL: файл с неоднозначным ФИО записался частично';
  END IF;

  v_result := public.import_equipment(jsonb_build_array(jsonb_build_object(
    'row', 2,
    'code', 'HACK-999',
    'code_prefix', 'IMPT',
    'serial_number', 'SN-IMPT-1',
    'inventory_number', 'ИНВ-1',
    'status', 'В работе',
    'location_path', 'Завод Импорт → Цех Импорт → Участок Импорт',
    'notes', 'из файла'
  )));
  IF v_result->'codes'->>0 <> 'IMPT-001' OR (v_result->>'created')::integer <> 1 THEN
    RAISE EXCEPTION 'FAIL: код выдала не база: %', v_result;
  END IF;
  IF EXISTS (SELECT 1 FROM public.equipment WHERE code = 'HACK-999') THEN
    RAISE EXCEPTION 'FAIL: колонка кода не проигнорирована';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.equipment
    WHERE code = 'IMPT-001'
      AND serial_number = 'SN-IMPT-1'
      AND inventory_number = 'ИНВ-1'
      AND status = 'in_work'
      AND notes = 'из файла'
  ) THEN
    RAISE EXCEPTION 'FAIL: единица IMPT-001 записана не так';
  END IF;

  SELECT last_number INTO v_last FROM public.code_counters WHERE prefix = 'IMPT';
  IF v_last <> 1 THEN
    RAISE EXCEPTION 'FAIL: счётчик IMPT = %', v_last;
  END IF;

  BEGIN
    PERFORM public.import_equipment(jsonb_build_array(
      jsonb_build_object(
        'row', 2,
        'code_prefix', 'IMPT',
        'serial_number', 'SN-ROLLBACK',
        'status', 'Резерв'
      ),
      jsonb_build_object(
        'row', 3,
        'code_prefix', 'NOPE',
        'status', 'В работе'
      )
    ));
    RAISE EXCEPTION 'FAIL: чужой префикс принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%не найдена%' THEN
        RAISE;
      END IF;
  END;

  SELECT last_number INTO v_last FROM public.code_counters WHERE prefix = 'IMPT';
  IF v_last <> 1 OR EXISTS (SELECT 1 FROM public.equipment WHERE serial_number = 'SN-ROLLBACK') THEN
    RAISE EXCEPTION 'FAIL: ошибка второй строки сожгла номер или оставила единицу, счётчик %', v_last;
  END IF;

  v_result := public.import_equipment(jsonb_build_array(
    jsonb_build_object(
      'row', 2,
      'code_prefix', 'SCAL2',
      'status', 'На поверке',
      'last_verification_date', '2026-01-15',
      'next_verification_date', '2027-01-15',
      'location_path', 'Завод Импорт → Цех Импорт → Участок Импорт'
    ),
    jsonb_build_object(
      'row', 3,
      'code_prefix', 'SCAL2',
      'status', 'in_work',
      'serial_number', 'SN-SCALE-A',
      'location_path', 'Завод Импорт → Цех Импорт → Участок Импорт'
    )
  ));
  IF v_result->'codes'->>0 <> 'SCAL2-001'
    OR v_result->'codes'->>1 <> 'SCAL2-002' THEN
    RAISE EXCEPTION 'FAIL: коды поверки %', v_result->'codes';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.equipment
    WHERE code = 'SCAL2-001'
      AND status = 'on_verification'
      AND last_verification_date = date '2026-01-15'
      AND next_verification_date = date '2027-01-15'
      AND location_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FAIL: даты или статус SCAL2-001';
  END IF;

  SELECT last_number INTO v_last FROM public.code_counters WHERE prefix = 'SCAL2';
  BEGIN
    PERFORM public.import_equipment(jsonb_build_array(
      jsonb_build_object(
        'row', 2,
        'code_prefix', 'SCAL2',
        'status', 'В работе',
        'serial_number', 'SN-SCALE-ROLLBACK'
      ),
      jsonb_build_object(
        'row', 3,
        'code_prefix', 'IMPT',
        'status', 'В работе',
        'last_verification_date', '2026-02-01'
      )
    ));
    RAISE EXCEPTION 'FAIL: даты поверки у принтера приняты';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%даты поверки%' THEN
        RAISE;
      END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.equipment WHERE serial_number = 'SN-SCALE-ROLLBACK')
    OR (SELECT last_number FROM public.code_counters WHERE prefix = 'SCAL2') <> v_last THEN
    RAISE EXCEPTION 'FAIL: файл с датами поверки не откатился';
  END IF;

  v_result := public.import_equipment(jsonb_build_array(
    jsonb_build_object('row', 2, 'code_prefix', 'IMPT', 'status', 'Списано', 'serial_number', 'SN-DUP', 'location_path', 'Завод Импорт → Цех Импорт → Участок Импорт'),
    jsonb_build_object('row', 3, 'code_prefix', 'IMPT', 'status', 'Резерв', 'serial_number', 'sn-dup', 'location_path', 'Завод Импорт → Цех Импорт → Участок Импорт')
  ));
  IF (v_result->>'created')::integer <> 2 OR jsonb_array_length(v_result->'warnings') <> 1 THEN
    RAISE EXCEPTION 'FAIL: предупреждение о серийнике %', v_result;
  END IF;
  IF v_result->'warnings'->0->>'message' NOT ILIKE '%Серийный номер%' THEN
    RAISE EXCEPTION 'FAIL: текст предупреждения %', v_result->'warnings';
  END IF;
  IF v_result->'codes'->>0 <> 'IMPT-002' OR v_result->'codes'->>1 <> 'IMPT-003' THEN
    RAISE EXCEPTION 'FAIL: коды после отката %', v_result->'codes';
  END IF;

  v_result := public.import_employees(jsonb_build_array(
    jsonb_build_object('row', 2, 'full_name', 'Анна Импорт', 'position', 'Метролог', 'phone', '123')
  ));
  IF (v_result->>'created')::integer <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.employees WHERE full_name = 'Анна Импорт' AND position = 'Метролог'
    ) THEN
    RAISE EXCEPTION 'FAIL: сотрудник не создан';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_editor::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_editor::text, 'role', 'authenticated')::text,
    false
  );
  BEGIN
    PERFORM public.import_nomenclature(jsonb_build_array(
      jsonb_build_object('row', 2, 'code_prefix', 'EDTR', 'name', 'Чужая', 'requires_verification', false)
    ));
    RAISE EXCEPTION 'FAIL: редактор импортировал номенклатуру';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Недостаточно прав%' THEN
        RAISE;
      END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.nomenclature WHERE code_prefix = 'EDTR') THEN
    RAISE EXCEPTION 'FAIL: номенклатура редактора записалась';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_viewer::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_viewer::text, 'role', 'authenticated')::text,
    false
  );
  BEGIN
    PERFORM public.import_equipment(jsonb_build_array(
      jsonb_build_object('row', 2, 'code_prefix', 'IMPT', 'status', 'В работе')
    ));
    RAISE EXCEPTION 'FAIL: зритель импортировал единицу';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Недостаточно прав%' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    false
  );
  SELECT last_number INTO v_last FROM public.code_counters WHERE prefix = 'IMPT';
  SELECT jsonb_agg(jsonb_build_object(
    'row', g,
    'full_name', 'Лишний ' || g
  ))
  INTO v_payload
  FROM generate_series(1, 2001) AS g;

  BEGIN
    PERFORM public.import_employees(v_payload);
    RAISE EXCEPTION 'FAIL: 2001 строка принята';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%2000%' THEN
        RAISE;
      END IF;
  END;
  IF EXISTS (SELECT 1 FROM public.employees WHERE full_name = 'Лишний 1') THEN
    RAISE EXCEPTION 'FAIL: длинный файл частично записался';
  END IF;
  IF (SELECT last_number FROM public.code_counters WHERE prefix = 'IMPT') <> v_last THEN
    RAISE EXCEPTION 'FAIL: длинный файл сдвинул счётчик';
  END IF;

  RAISE NOTICE 'ok: excel import';
END;
$$;

-- Тот же импорт под ролью authenticated, не из-под суперпользователя.
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
  v_result jsonb;
BEGIN
  v_result := public.import_nomenclature(jsonb_build_array(
    jsonb_build_object('row', 2, 'code_prefix', 'RLS1', 'name', 'Под RLS', 'requires_verification', false)
  ));
  IF (v_result->>'created')::integer <> 1 THEN
    RAISE EXCEPTION 'FAIL: admin под RLS не импортировал';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.nomenclature WHERE code_prefix = 'RLS1') THEN
    RAISE EXCEPTION 'FAIL: строка RLS1 не видна';
  END IF;
  RAISE NOTICE 'ok: import under rls';
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
    PERFORM public.import_employees(jsonb_build_array(
      jsonb_build_object('row', 2, 'full_name', 'Редактор не может')
    ));
    RAISE EXCEPTION 'FAIL: редактор под RLS импортировал';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Недостаточно прав%' THEN
        RAISE;
      END IF;
  END;
  RAISE NOTICE 'ok: editor import denied under rls';
END;
$$;
ROLLBACK;
