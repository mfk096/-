-- Проверка локальных примерных данных после seed.sql.

DO $$
DECLARE
  v_path text;
  v_name text;
  v_date date;
  v_next date;
BEGIN
  IF (SELECT role FROM public.profiles WHERE id = 'a1111111-1111-4111-8111-111111111111') <> 'admin' THEN
    RAISE EXCEPTION 'FAIL: демо-администратор';
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = 'a2222222-2222-4222-8222-222222222222') <> 'editor' THEN
    RAISE EXCEPTION 'FAIL: демо-редактор';
  END IF;
  IF (SELECT role FROM public.profiles WHERE id = 'a3333333-3333-4333-8333-333333333333') <> 'viewer' THEN
    RAISE EXCEPTION 'FAIL: демо-зритель';
  END IF;

  SELECT full_path, effective_responsible_name
  INTO v_path, v_name
  FROM public.locations_with_path
  WHERE id = 'c3333333-3333-4333-8333-333333333333';

  IF v_path <> 'Завод «Северный» → Цех механообработки → Участок печати' THEN
    RAISE EXCEPTION 'FAIL: путь участка печати «%»', v_path;
  END IF;
  IF v_name <> 'Иван Петров' THEN
    RAISE EXCEPTION 'FAIL: участок печати должен наследовать Ивана, сейчас %', v_name;
  END IF;

  SELECT effective_responsible_name
  INTO v_name
  FROM public.locations_with_path
  WHERE id = 'c4444444-4444-4444-8444-444444444444';
  IF v_name <> 'Мария Соколова' THEN
    RAISE EXCEPTION 'FAIL: метрология должна быть на Марии, сейчас %', v_name;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.locations
    WHERE name = 'Старый склад' AND is_archived
  ) THEN
    RAISE EXCEPTION 'FAIL: нет архивного склада';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = 'KYOC-001' AND serial_number = 'SN-KYOC-10001') THEN
    RAISE EXCEPTION 'FAIL: KYOC-001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = 'KYOC-002') THEN
    RAISE EXCEPTION 'FAIL: KYOC-002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = 'SCALE-001') THEN
    RAISE EXCEPTION 'FAIL: SCALE-001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.equipment WHERE code = 'DELL-001' AND status = 'in_repair') THEN
    RAISE EXCEPTION 'FAIL: DELL-001';
  END IF;

  IF (SELECT last_number FROM public.code_counters WHERE prefix = 'KYOC') <> 2
    OR (SELECT last_number FROM public.code_counters WHERE prefix = 'SCALE') <> 1
    OR (SELECT last_number FROM public.code_counters WHERE prefix = 'DELL') <> 1 THEN
    RAISE EXCEPTION 'FAIL: счётчики сида';
  END IF;

  SELECT e.last_verification_date, e.next_verification_date
  INTO v_date, v_next
  FROM public.equipment AS e
  WHERE e.code = 'SCALE-001';
  IF v_date <> date '2026-03-15' OR v_next <> date '2027-03-15' THEN
    RAISE EXCEPTION 'FAIL: даты поверки весов % / %', v_date, v_next;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.equipment AS e
    JOIN public.nomenclature AS n ON n.id = e.nomenclature_id
    WHERE n.code_prefix = 'KYOC'
      AND (e.last_verification_date IS NOT NULL OR e.next_verification_date IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'FAIL: у принтера заполнены поля поверки';
  END IF;

  IF (
    SELECT count(*)
    FROM public.movements AS m
    JOIN public.equipment AS e ON e.id = m.equipment_id
    WHERE e.code = 'KYOC-001'
  ) <> 1 THEN
    RAISE EXCEPTION 'FAIL: у KYOC-001 нет начального перемещения';
  END IF;

  RAISE NOTICE 'ok: seed';
END;
$$;
