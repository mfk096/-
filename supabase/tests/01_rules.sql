-- Правила кодов, истории, поверок и дерева мест. Сессия — суперпользователь с jwt пользователя.

DO $$
DECLARE
  v_admin uuid := '11111111-1111-4111-8111-111111111111';
  v_editor uuid := '11111111-1111-4111-8111-111111111112';
  v_viewer uuid := '11111111-1111-4111-8111-111111111113';
  v_inactive uuid := '11111111-1111-4111-8111-111111111114';
  v_gmail uuid := '11111111-1111-4111-8111-111111111115';
  v_race uuid := '22222222-2222-4222-8222-222222222222';
  v_fix uuid := '33333333-3333-4333-8333-333333333333';
  v_loc_a uuid := '55555555-5555-4555-8555-555555555551';
  v_loc_b uuid := '55555555-5555-4555-8555-555555555552';
  v_nom uuid;
  v_other uuid;
  v_eq uuid;
  v_loc uuid;
  v_child uuid;
  v_code text;
  v_count integer;
  v_last integer;
  v_actor uuid;
  v_from uuid;
  v_text text;
  v_date date;
BEGIN
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES
    (v_admin, 'tester@example.com', '{"full_name":"Тестер"}'::jsonb),
    (v_editor, 'editor@example.com', '{"full_name":"Редактор"}'::jsonb),
    (v_viewer, 'viewer@example.com', '{"full_name":"Смотритель"}'::jsonb),
    (v_inactive, 'inactive@example.com', '{"full_name":"Отключён"}'::jsonb),
    (v_gmail, 'KB09062001@gmail.com', '{"full_name":"Координатор"}'::jsonb);

  IF (SELECT role FROM public.profiles WHERE id = v_admin) <> 'viewer' THEN
    RAISE EXCEPTION 'FAIL: новый профиль должен быть viewer';
  END IF;

  UPDATE public.profiles SET role = 'admin' WHERE id = v_admin;
  UPDATE public.profiles SET role = 'editor' WHERE id = v_editor;
  UPDATE public.profiles SET role = 'viewer' WHERE id = v_viewer;
  UPDATE public.profiles SET role = 'viewer', is_active = false WHERE id = v_inactive;

  PERFORM public.backfill_profiles();
  IF (SELECT role FROM public.profiles WHERE id = v_gmail) <> 'admin' THEN
    RAISE EXCEPTION 'FAIL: kb09062001@gmail.com не стал admin';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    false
  );

  IF public.current_role() <> 'admin' THEN
    RAISE EXCEPTION 'FAIL: public.current_role() = %', public.current_role();
  END IF;

  BEGIN
    UPDATE public.profiles SET role = 'editor' WHERE id = v_admin;
    RAISE EXCEPTION 'FAIL: свою роль удалось сменить';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%собственную роль%' THEN
        RAISE;
      END IF;
  END;

  IF (SELECT role FROM public.profiles WHERE id = v_admin) <> 'admin' THEN
    RAISE EXCEPTION 'FAIL: роль администратора откатилась не туда';
  END IF;

  BEGIN
    INSERT INTO public.nomenclature (code_prefix, name) VALUES ('A', 'Короткий');
    RAISE EXCEPTION 'FAIL: короткий префикс принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Префикс%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO public.nomenclature (code_prefix, name) VALUES ('ABCDEFGHI', 'Длинный');
    RAISE EXCEPTION 'FAIL: длинный префикс принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Префикс%' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO public.nomenclature (code_prefix, name) VALUES ('tmp', 'Временная');
  SELECT id INTO v_nom FROM public.nomenclature WHERE code_prefix = 'TMP';
  IF v_nom IS NULL THEN
    RAISE EXCEPTION 'FAIL: префикс не приведён к верхнему регистру';
  END IF;

  UPDATE public.nomenclature SET code_prefix = 'TMP2' WHERE id = v_nom;
  IF NOT EXISTS (SELECT 1 FROM public.code_counters WHERE prefix = 'TMP2' AND last_number = 0) THEN
    RAISE EXCEPTION 'FAIL: счётчик не переехал вместе с префиксом';
  END IF;

  INSERT INTO public.equipment (nomenclature_id, code, status)
  VALUES (v_nom, 'HACK-001', 'in_work')
  RETURNING id, code INTO v_eq, v_code;

  IF v_code <> 'TMP2-001' THEN
    RAISE EXCEPTION 'FAIL: код клиента не проигнорирован, получен %', v_code;
  END IF;

  BEGIN
    UPDATE public.nomenclature SET code_prefix = 'TMP3' WHERE id = v_nom;
    RAISE EXCEPTION 'FAIL: префикс изменён после появления единицы';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Префикс нельзя изменить%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE public.equipment SET code = 'TMP2-999' WHERE id = v_eq;
    RAISE EXCEPTION 'FAIL: код единицы изменён';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Код единицы нельзя изменить%' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO public.nomenclature (code_prefix, name) VALUES ('SEQ', 'Последовательная');
  SELECT id INTO v_nom FROM public.nomenclature WHERE code_prefix = 'SEQ';
  INSERT INTO public.equipment (nomenclature_id, status) VALUES (v_nom, 'in_work');
  INSERT INTO public.equipment (nomenclature_id, status) VALUES (v_nom, 'reserve');
  INSERT INTO public.equipment (nomenclature_id, status) VALUES (v_nom, 'in_repair');
  UPDATE public.equipment SET status = 'written_off' WHERE code = 'SEQ-001';
  INSERT INTO public.equipment (nomenclature_id, status) VALUES (v_nom, 'in_work');

  IF (
    SELECT array_agg(code ORDER BY code)
    FROM public.equipment
    WHERE nomenclature_id = v_nom
  ) <> ARRAY['SEQ-001', 'SEQ-002', 'SEQ-003', 'SEQ-004']::text[] THEN
    RAISE EXCEPTION 'FAIL: номера SEQ переиспользованы или с дырой не по счётчику';
  END IF;

  SELECT last_number INTO v_last FROM public.code_counters WHERE prefix = 'SEQ';
  IF v_last <> 4 THEN
    RAISE EXCEPTION 'FAIL: счётчик SEQ = %', v_last;
  END IF;

  BEGIN
    DELETE FROM public.equipment WHERE code = 'SEQ-001';
    RAISE EXCEPTION 'FAIL: единицу удалось удалить';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%нельзя удалить%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    UPDATE public.code_counters SET last_number = 1 WHERE prefix = 'SEQ';
    RAISE EXCEPTION 'FAIL: счётчик уменьшился';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%нельзя уменьшать%' THEN
        RAISE;
      END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.equipment WHERE code = 'SEQ-001' AND status <> 'written_off') THEN
    RAISE EXCEPTION 'FAIL: списанная единица пропала';
  END IF;

  INSERT INTO public.nomenclature (code_prefix, name) VALUES ('AA', 'Первая');
  INSERT INTO public.nomenclature (code_prefix, name) VALUES ('BB', 'Вторая');
  INSERT INTO public.equipment (nomenclature_id)
  SELECT id FROM public.nomenclature WHERE code_prefix = 'AA';
  INSERT INTO public.equipment (nomenclature_id)
  SELECT id FROM public.nomenclature WHERE code_prefix = 'BB';
  IF NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = 'AA-001')
    OR NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = 'BB-001') THEN
    RAISE EXCEPTION 'FAIL: счётчики префиксов не независимы';
  END IF;

  INSERT INTO public.nomenclature (code_prefix, name) VALUES ('PAD', 'Добивка');
  UPDATE public.code_counters SET last_number = 998 WHERE prefix = 'PAD';
  INSERT INTO public.equipment (nomenclature_id)
  SELECT id FROM public.nomenclature WHERE code_prefix = 'PAD';
  INSERT INTO public.equipment (nomenclature_id)
  SELECT id FROM public.nomenclature WHERE code_prefix = 'PAD';
  IF NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = 'PAD-999')
    OR NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = 'PAD-1000') THEN
    RAISE EXCEPTION 'FAIL: формат номера вокруг 1000';
  END IF;

  INSERT INTO public.nomenclature (code_prefix, name) VALUES ('ROLL', 'Откат');
  PERFORM set_config('request.jwt.claim.sub', '', false);
  PERFORM set_config('request.jwt.claims', '', false);
  BEGIN
    INSERT INTO public.equipment (nomenclature_id)
    SELECT id FROM public.nomenclature WHERE code_prefix = 'ROLL';
    RAISE EXCEPTION 'FAIL: единица без пользователя создана';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%вошедшего пользователя%' THEN
        RAISE;
      END IF;
  END;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    false
  );
  INSERT INTO public.equipment (nomenclature_id)
  SELECT id FROM public.nomenclature WHERE code_prefix = 'ROLL';
  IF (SELECT last_number FROM public.code_counters WHERE prefix = 'ROLL') <> 1
    OR NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = 'ROLL-001') THEN
    RAISE EXCEPTION 'FAIL: неудачная вставка заняла номер';
  END IF;

  INSERT INTO public.nomenclature (code_prefix, name, requires_verification)
  VALUES ('NOVF', 'Без поверки', false);
  SELECT id INTO v_nom FROM public.nomenclature WHERE code_prefix = 'NOVF';
  BEGIN
    INSERT INTO public.equipment (nomenclature_id, last_verification_date)
    VALUES (v_nom, date '2026-01-01');
    RAISE EXCEPTION 'FAIL: дату поверки приняли без флага';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%поверки%' THEN
        RAISE;
      END IF;
  END;
  IF (SELECT last_number FROM public.code_counters WHERE prefix = 'NOVF') <> 0 THEN
    RAISE EXCEPTION 'FAIL: отказ в полях поверки занял номер';
  END IF;

  INSERT INTO public.locations (id, name, kind) VALUES (v_loc_a, 'Стенд А', 'участок');
  INSERT INTO public.locations (id, name, kind, is_archived)
  VALUES (v_loc_b, 'Стенд Б', 'участок', true);

  BEGIN
    INSERT INTO public.equipment (nomenclature_id, location_id)
    VALUES (v_nom, v_loc_b);
    RAISE EXCEPTION 'FAIL: архивное место назначено';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Архивное место%' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO public.equipment (nomenclature_id, location_id, serial_number, status)
  VALUES (v_nom, v_loc_a, '   ', 'in_work')
  RETURNING id INTO v_eq;

  IF (SELECT serial_number FROM public.equipment WHERE id = v_eq) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: пустой серийный номер не стал NULL';
  END IF;

  SELECT count(*) INTO v_count FROM public.movements WHERE equipment_id = v_eq;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: начальных перемещений %', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.status_changes WHERE equipment_id = v_eq;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: начальных статусов %', v_count;
  END IF;

  SELECT from_location_id, to_location_id, moved_by
  INTO v_from, v_loc, v_actor
  FROM public.movements
  WHERE equipment_id = v_eq;
  IF v_from IS NOT NULL OR v_loc <> v_loc_a OR v_actor <> v_admin THEN
    RAISE EXCEPTION 'FAIL: начальное перемещение записано неверно';
  END IF;

  IF (
    SELECT from_status IS NOT NULL OR to_status <> 'in_work' OR changed_by <> v_admin
    FROM public.status_changes
    WHERE equipment_id = v_eq
  ) THEN
    RAISE EXCEPTION 'FAIL: начальный статус записан неверно';
  END IF;

  UPDATE public.equipment SET notes = 'заметка' WHERE id = v_eq;
  SELECT count(*) INTO v_count FROM public.movements WHERE equipment_id = v_eq;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: заметка породила перемещение';
  END IF;

  INSERT INTO public.nomenclature (code_prefix, name)
  VALUES ('OTHR', 'Другая модель')
  RETURNING id INTO v_other;

  BEGIN
    UPDATE public.equipment SET nomenclature_id = v_other WHERE id = v_eq;
    RAISE EXCEPTION 'FAIL: номенклатура единицы изменена';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Номенклатуру единицы нельзя изменить%' THEN
        RAISE;
      END IF;
  END;

  UPDATE public.locations SET is_archived = false WHERE id = v_loc_b;

  PERFORM public.move_equipment(v_eq, v_loc_b, '  перенос на стенд  ');
  SELECT m.comment, m.from_location_id, m.to_location_id, m.moved_by
  INTO v_text, v_from, v_loc, v_actor
  FROM public.movements AS m
  WHERE m.equipment_id = v_eq
    AND m.comment = 'перенос на стенд';
  IF v_text <> 'перенос на стенд' OR v_from <> v_loc_a OR v_loc <> v_loc_b OR v_actor <> v_admin THEN
    RAISE EXCEPTION 'FAIL: move_equipment записал % / % -> %', v_text, v_from, v_loc;
  END IF;

  BEGIN
    PERFORM public.move_equipment(v_eq, v_loc_b, 'ещё раз');
    RAISE EXCEPTION 'FAIL: перемещение в то же место прошло';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Место не изменилось%' THEN
        RAISE;
      END IF;
  END;

  PERFORM public.change_equipment_status(v_eq, 'written_off', 'списание');
  PERFORM public.move_equipment(v_eq, v_loc_a, 'со склада списанных');
  IF (SELECT status FROM public.equipment WHERE id = v_eq) <> 'written_off' THEN
    RAISE EXCEPTION 'FAIL: перемещение сбило статус списания';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.status_changes
    WHERE equipment_id = v_eq
      AND from_status = 'in_work'
      AND to_status = 'written_off'
      AND comment = 'списание'
      AND changed_by = v_admin
  ) THEN
    RAISE EXCEPTION 'FAIL: смена статуса не попала в историю';
  END IF;

  BEGIN
    PERFORM public.change_equipment_status(v_eq, 'written_off', 'повтор');
    RAISE EXCEPTION 'FAIL: повтор статуса прошёл';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Статус не изменился%' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO public.movements (equipment_id, to_location_id, moved_by, comment)
  VALUES (v_eq, v_loc_b, v_editor, 'подмена автора');
  SELECT moved_by INTO v_actor
  FROM public.movements
  WHERE equipment_id = v_eq AND comment = 'подмена автора';
  IF v_actor <> v_admin THEN
    RAISE EXCEPTION 'FAIL: moved_by можно подменить';
  END IF;

  BEGIN
    UPDATE public.movements
    SET to_location_id = v_loc_a
    WHERE equipment_id = v_eq AND comment = 'подмена автора';
    RAISE EXCEPTION 'FAIL: факты истории перемещений изменены';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%только комментарий%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    DELETE FROM public.movements WHERE equipment_id = v_eq;
    RAISE EXCEPTION 'FAIL: историю удалили';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%истории нельзя удалить%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO public.verifications (equipment_id, verified_at, result)
    VALUES (v_eq, now(), 'passed');
    RAISE EXCEPTION 'FAIL: поверка без флага записана';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%не требует поверки%' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO public.nomenclature (
    code_prefix,
    name,
    requires_verification,
    verification_interval_months
  )
  VALUES ('VERF', 'С поверкой', true, 12)
  RETURNING id INTO v_nom;

  INSERT INTO public.equipment (nomenclature_id, status)
  VALUES (v_nom, 'in_work')
  RETURNING id INTO v_eq;

  INSERT INTO public.verifications (equipment_id, verified_at, result, next_due_at, certificate_number)
  VALUES (v_eq, timestamptz '2026-05-01 10:00:00+00', 'passed', date '2027-05-01', 'СП-1');
  INSERT INTO public.verifications (equipment_id, verified_at, result, next_due_at)
  VALUES (v_eq, timestamptz '2024-01-01 10:00:00+00', 'failed', date '2024-06-01');

  SELECT last_verification_date, next_verification_date
  INTO v_date, v_text
  FROM public.equipment
  WHERE id = v_eq;

  IF v_date <> date '2026-05-01' OR v_text::date <> date '2027-05-01' THEN
    RAISE EXCEPTION 'FAIL: даты поверки взяты не из последней по времени записи (% / %)', v_date, v_text;
  END IF;

  INSERT INTO public.locations (name, kind) VALUES ('Завод', 'завод') RETURNING id INTO v_loc;
  INSERT INTO public.locations (parent_id, name, kind) VALUES (v_loc, 'Цех', 'цех') RETURNING id INTO v_child;
  UPDATE public.locations SET responsible_employee_id = NULL WHERE id = v_child;

  INSERT INTO public.employees (full_name) VALUES ('Иван Тестов') RETURNING id INTO v_actor;
  UPDATE public.locations SET responsible_employee_id = v_actor WHERE id = v_loc;

  INSERT INTO public.locations (parent_id, name, kind)
  VALUES (v_child, 'Участок', 'участок')
  RETURNING id INTO v_eq;

  IF public.location_full_path(v_eq) <> 'Завод → Цех → Участок' THEN
    RAISE EXCEPTION 'FAIL: путь «%»', public.location_full_path(v_eq);
  END IF;
  IF public.effective_responsible_employee_id(v_eq) <> v_actor THEN
    RAISE EXCEPTION 'FAIL: ответственный не унаследован';
  END IF;

  UPDATE public.locations
  SET responsible_employee_id = (SELECT id FROM public.employees WHERE full_name = 'Иван Тестов' LIMIT 1)
  WHERE id = v_child;
  -- child gets own responsible, different person
  INSERT INTO public.employees (full_name) VALUES ('Мария Тестова') RETURNING id INTO v_from;
  UPDATE public.locations SET responsible_employee_id = v_from WHERE id = v_eq;
  IF public.effective_responsible_employee_id(v_eq) <> v_from THEN
    RAISE EXCEPTION 'FAIL: свой ответственный не перекрыл предка';
  END IF;

  BEGIN
    UPDATE public.locations SET parent_id = v_eq WHERE id = v_loc;
    RAISE EXCEPTION 'FAIL: цикл в дереве принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Цикл%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO public.locations (id, parent_id, name, kind)
    VALUES (
      '66666666-6666-4666-8666-666666666666',
      '66666666-6666-4666-8666-666666666666',
      'Петля',
      'участок'
    );
    RAISE EXCEPTION 'FAIL: самоссылка места принята';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%само%' AND SQLERRM NOT ILIKE '%Цикл%' THEN
        RAISE;
      END IF;
  END;

  INSERT INTO public.nomenclature (id, code_prefix, name)
  VALUES (v_fix, 'FIX', 'Фикстура RLS');
  INSERT INTO public.nomenclature (id, code_prefix, name)
  VALUES (v_race, 'RACE', 'Гонка кодов');

  IF (SELECT last_number FROM public.code_counters WHERE prefix = 'RACE') <> 0 THEN
    RAISE EXCEPTION 'FAIL: RACE уже не пустой';
  END IF;

  RAISE NOTICE 'ok: rules';
END;
$$;
