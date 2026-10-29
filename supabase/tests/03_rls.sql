-- RLS под ролями anon / authenticated. Каждая проверка откатывается.

-- Зритель читает единицы и представление пути.
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
  IF public.current_role() <> 'viewer' THEN
    RAISE EXCEPTION 'FAIL: роль зрителя %', public.current_role();
  END IF;
  SELECT count(*) INTO v_count FROM public.equipment;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'FAIL: зритель не видит единицы';
  END IF;
  SELECT count(*) INTO v_count FROM public.equipment_list;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'FAIL: зритель не видит equipment_list';
  END IF;
  SELECT count(*) INTO v_count FROM public.locations_with_path;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'FAIL: зритель не видит путь мест';
  END IF;
  UPDATE public.equipment SET notes = 'нельзя';
  IF FOUND THEN
    RAISE EXCEPTION 'FAIL: зритель изменил единицу';
  END IF;
  BEGIN
    INSERT INTO public.nomenclature (code_prefix, name) VALUES ('VIEW', 'Чужая');
    RAISE EXCEPTION 'FAIL: зритель создал номенклатуру';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    INSERT INTO public.equipment (nomenclature_id)
    SELECT id FROM public.nomenclature WHERE code_prefix = 'FIX';
    RAISE EXCEPTION 'FAIL: зритель создал единицу';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  RAISE NOTICE 'ok: viewer read only';
END;
$$;
ROLLBACK;

-- Отключённый пользователь не видит строки.
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
  IF public.current_role() IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: у отключённого есть роль %', public.current_role();
  END IF;
  SELECT count(*) INTO v_count FROM public.equipment;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: отключённый видит % единиц', v_count;
  END IF;
  SELECT count(*) INTO v_count FROM public.profiles;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: отключённый видит профили';
  END IF;
  RAISE NOTICE 'ok: inactive';
END;
$$;
ROLLBACK;

-- anon не имеет прав.
BEGIN;
SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.equipment;
    RAISE EXCEPTION 'FAIL: anon прочитал equipment';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.nomenclature;
    RAISE EXCEPTION 'FAIL: anon прочитал nomenclature';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;
  RAISE NOTICE 'ok: anon';
END;
$$;
ROLLBACK;

-- Редактор пишет единицы и не пишет справочник. Код назначает база.
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
  v_actor uuid;
BEGIN
  IF public.current_role() <> 'editor' THEN
    RAISE EXCEPTION 'FAIL: роль редактора %', public.current_role();
  END IF;

  BEGIN
    INSERT INTO public.nomenclature (code_prefix, name) VALUES ('EDTR', 'Нельзя');
    RAISE EXCEPTION 'FAIL: редактор создал номенклатуру';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    INSERT INTO public.locations (name, kind) VALUES ('Чужое место', 'цех');
    RAISE EXCEPTION 'FAIL: редактор создал место';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  BEGIN
    UPDATE public.code_counters SET last_number = last_number WHERE prefix = 'FIX';
    RAISE EXCEPTION 'FAIL: редактор обновил счётчик';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  INSERT INTO public.equipment (nomenclature_id, code, serial_number, status)
  SELECT id, 'NOPE-1', 'editor-serial', 'reserve'
  FROM public.nomenclature
  WHERE code_prefix = 'FIX'
  RETURNING id, code INTO v_eq, v_code;

  IF v_code IS NULL OR v_code = 'NOPE-1' OR v_code NOT LIKE 'FIX-%' THEN
    RAISE EXCEPTION 'FAIL: редактору выдан код %', v_code;
  END IF;

  SELECT moved_by INTO v_actor FROM public.movements WHERE equipment_id = v_eq;
  IF v_actor <> '11111111-1111-4111-8111-111111111112' THEN
    RAISE EXCEPTION 'FAIL: история редактора записана на %', v_actor;
  END IF;

  UPDATE public.profiles
  SET role = 'admin'
  WHERE id = '11111111-1111-4111-8111-111111111113';
  IF FOUND THEN
    RAISE EXCEPTION 'FAIL: редактор сменил чужую роль';
  END IF;

  RAISE NOTICE 'ok: editor';
END;
$$;
ROLLBACK;

-- Администратор пишет справочник, но не свою роль. Чужую роль меняет.
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
  v_role public.app_role;
BEGIN
  INSERT INTO public.nomenclature (code_prefix, name) VALUES ('ADMN', 'От администратора');
  IF NOT EXISTS (SELECT 1 FROM public.nomenclature WHERE code_prefix = 'ADMN') THEN
    RAISE EXCEPTION 'FAIL: администратор не создал номенклатуру';
  END IF;

  UPDATE public.profiles
  SET full_name = 'Тестер переименован'
  WHERE id = '11111111-1111-4111-8111-111111111111';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL: администратор не обновил своё имя';
  END IF;

  BEGIN
    UPDATE public.profiles
    SET role = 'viewer'
    WHERE id = '11111111-1111-4111-8111-111111111111';
    RAISE EXCEPTION 'FAIL: администратор сменил себе роль';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%собственную роль%' THEN
        RAISE;
      END IF;
  END;

  UPDATE public.profiles
  SET role = 'editor'
  WHERE id = '11111111-1111-4111-8111-111111111113';
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = '11111111-1111-4111-8111-111111111113';
  IF v_role <> 'editor' THEN
    RAISE EXCEPTION 'FAIL: администратор не сменил чужую роль, сейчас %', v_role;
  END IF;

  BEGIN
    DELETE FROM public.equipment WHERE code LIKE 'RACE-%';
    RAISE EXCEPTION 'FAIL: администратор удалил единицу';
  EXCEPTION
    WHEN insufficient_privilege THEN
      NULL;
  END;

  RAISE NOTICE 'ok: admin';
END;
$$;
ROLLBACK;

-- Редактор вызывает RPC перемещения, зритель — нет.
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
  v_eq uuid;
BEGIN
  SELECT id INTO v_eq FROM public.equipment WHERE code = 'ROLL-001';
  BEGIN
    PERFORM public.move_equipment(v_eq, '55555555-5555-4555-8555-555555555551', 'нельзя');
    RAISE EXCEPTION 'FAIL: зритель вызвал move_equipment';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Недостаточно прав%' THEN
        RAISE;
      END IF;
  END;
  RAISE NOTICE 'ok: viewer rpc';
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
DECLARE
  v_eq uuid;
  v_comment text;
BEGIN
  SELECT id INTO v_eq FROM public.equipment WHERE code = 'ROLL-001';
  PERFORM public.move_equipment(v_eq, '55555555-5555-4555-8555-555555555551', 'редактор перенёс');
  SELECT m.comment
  INTO v_comment
  FROM public.movements AS m
  WHERE m.equipment_id = v_eq
    AND m.comment = 'редактор перенёс';
  IF v_comment <> 'редактор перенёс' THEN
    RAISE EXCEPTION 'FAIL: RPC редактора, комментарий %', v_comment;
  END IF;
  PERFORM public.change_equipment_status(v_eq, 'in_repair', 'в ремонт');
  IF NOT EXISTS (
    SELECT 1
    FROM public.status_changes
    WHERE equipment_id = v_eq
      AND to_status = 'in_repair'
      AND comment = 'в ремонт'
      AND changed_by = '11111111-1111-4111-8111-111111111112'
  ) THEN
    RAISE EXCEPTION 'FAIL: RPC статуса редактора';
  END IF;
  RAISE NOTICE 'ok: editor rpc';
END;
$$;
ROLLBACK;
