-- Смена префикса переписывает коды, старый код остаётся занят.
-- Вставка уровня над узлом не создаёт цикл. Пустое место у новой единицы отвергается.

BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',
  true
);

DO $$
DECLARE
  v_nom uuid;
  v_place uuid;
  v_above uuid;
  v_written uuid;
  v_live uuid;
  v_code text;
BEGIN
  INSERT INTO public.nomenclature (code_prefix, name)
  VALUES ('KYOC', 'Префикс владелец')
  RETURNING id INTO v_nom;

  INSERT INTO public.locations (name) VALUES ('Полка владельца') RETURNING id INTO v_place;

  INSERT INTO public.equipment (nomenclature_id, status, location_id)
  VALUES (v_nom, 'written_off', v_place)
  RETURNING id, code INTO v_written, v_code;
  INSERT INTO public.equipment (nomenclature_id, status, location_id)
  VALUES (v_nom, 'reserve', v_place)
  RETURNING id INTO v_live;

  IF v_code <> 'KYOC-001' THEN
    RAISE EXCEPTION 'FAIL: первый код %', v_code;
  END IF;

  PERFORM public.rename_nomenclature_prefix(v_nom, 'kypr');

  IF (SELECT code FROM public.equipment WHERE id = v_written) <> 'KYPR-001'
    OR (SELECT code FROM public.equipment WHERE id = v_live) <> 'KYPR-002' THEN
    RAISE EXCEPTION 'FAIL: номера не сохранились при смене префикса';
  END IF;
  IF (SELECT code_prefix FROM public.nomenclature WHERE id = v_nom) <> 'KYPR' THEN
    RAISE EXCEPTION 'FAIL: префикс номенклатуры';
  END IF;
  IF (SELECT last_number FROM public.code_counters WHERE prefix = 'KYPR') <> 2 THEN
    RAISE EXCEPTION 'FAIL: счётчик не переехал';
  END IF;
  IF EXISTS (SELECT 1 FROM public.code_counters WHERE prefix = 'KYOC') THEN
    RAISE EXCEPTION 'FAIL: старый счётчик остался отдельной строкой';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.equipment_former_codes
    WHERE code = 'KYOC-001' AND equipment_id = v_written
  ) OR NOT EXISTS (
    SELECT 1 FROM public.equipment_former_codes
    WHERE code = 'KYOC-002' AND equipment_id = v_live
  ) THEN
    RAISE EXCEPTION 'FAIL: история старых кодов';
  END IF;

  INSERT INTO public.nomenclature (code_prefix, name) VALUES ('KYOC', 'Повтор префикса');
  INSERT INTO public.equipment (nomenclature_id, status, location_id)
  SELECT id, 'in_work', v_place FROM public.nomenclature WHERE code_prefix = 'KYOC'
  RETURNING code INTO v_code;
  IF v_code <> 'KYOC-003' THEN
    RAISE EXCEPTION 'FAIL: старый номер переиспользован, выдан %', v_code;
  END IF;
  IF EXISTS (SELECT 1 FROM public.equipment WHERE code IN ('KYOC-001', 'KYOC-002')) THEN
    RAISE EXCEPTION 'FAIL: старые коды снова в единицах';
  END IF;

  SELECT public.insert_location_above(v_place, 'Этаж') INTO v_above;
  IF (SELECT parent_id FROM public.locations WHERE id = v_place) <> v_above THEN
    RAISE EXCEPTION 'FAIL: место не подвешено к новому уровню';
  END IF;

  BEGIN
    PERFORM public.insert_location_above(v_above, 'Петля');
    UPDATE public.locations SET parent_id = v_place WHERE id = v_above;
    RAISE EXCEPTION 'FAIL: цикл принят';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Цикл%' AND SQLERRM NOT ILIKE '%вложен%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    INSERT INTO public.equipment (nomenclature_id, status)
    VALUES (v_nom, 'in_work');
    RAISE EXCEPTION 'FAIL: единица без места создана';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT ILIKE '%Укажите место установки%' THEN
        RAISE;
      END IF;
  END;

  RAISE NOTICE 'ok: owner prefix and places';
END;
$$;
ROLLBACK;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.rename_nomenclature_prefix(uuid,text)', 'EXECUTE')
    OR has_function_privilege('public', 'public.rename_nomenclature_prefix(uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.insert_location_above(uuid,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.prefix_high_water(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon исполняет функции этапа 7';
  END IF;
  RAISE NOTICE 'ok: owner privileges';
END;
$$;
