-- Этап 7, решения владельца.
-- Смена префикса переписывает коды единиц и оставляет старые коды занятыми.
-- Вид места больше не обязателен. Новые и изменяемые единицы требуют место.
-- Файл идемпотентный. anon не получает EXECUTE. storage.objects не трогаем.

ALTER TABLE public.locations
  ALTER COLUMN kind DROP NOT NULL;

ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_kind_chk;

ALTER TABLE public.locations
  ADD CONSTRAINT locations_kind_chk
  CHECK (kind IS NULL OR char_length(btrim(kind)) > 0);

COMMENT ON COLUMN public.locations.kind IS
  'Устаревшая подпись уровня. В интерфейсе не используется, для новых мест может быть пустой.';

COMMENT ON COLUMN public.nomenclature.code_prefix IS
  '2–8 символов A–Z и цифр. Смена префикса меняет коды всех единиц этой номенклатуры, номера сохраняются.';

CREATE TABLE IF NOT EXISTS public.equipment_former_codes (
  code text PRIMARY KEY,
  equipment_id uuid NOT NULL REFERENCES public.equipment (id) ON DELETE CASCADE,
  replaced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_former_codes_format_chk CHECK (code ~ '^[A-Z0-9]{2,8}-[0-9]+$')
);

COMMENT ON TABLE public.equipment_former_codes IS
  'Старые коды единиц после смены префикса. Код больше никому не выдаётся. Скан открывает текущую единицу.';

CREATE INDEX IF NOT EXISTS equipment_former_codes_equipment_idx
  ON public.equipment_former_codes (equipment_id);

ALTER TABLE public.equipment_former_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.equipment_former_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.equipment_former_codes TO authenticated;

DROP POLICY IF EXISTS equipment_former_codes_select ON public.equipment_former_codes;
CREATE POLICY equipment_former_codes_select ON public.equipment_former_codes
  FOR SELECT TO authenticated
  USING (public.current_role() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.prefix_high_water(p_prefix text)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(MAX(suffix), 0)
  FROM (
    SELECT substring(e.code FROM '-([0-9]+)$')::integer AS suffix
    FROM public.equipment AS e
    WHERE e.code ~ ('^' || p_prefix || '-[0-9]+$')
    UNION ALL
    SELECT substring(a.code FROM '-([0-9]+)$')::integer
    FROM public.equipment_former_codes AS a
    WHERE a.code ~ ('^' || p_prefix || '-[0-9]+$')
  ) AS used;
$$;

COMMENT ON FUNCTION public.prefix_high_water(text) IS
  'Максимальный уже выданный номер префикса, включая старые коды. Нулевое значение — номеров ещё не было.';

CREATE OR REPLACE FUNCTION public.nomenclature_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.code_prefix := upper(btrim(NEW.code_prefix));

  IF NEW.code_prefix !~ '^[A-Z0-9]{2,8}$' THEN
    RAISE EXCEPTION 'Префикс: от 2 до 8 символов, только A–Z и цифры';
  END IF;

  IF NEW.requires_verification THEN
    IF NEW.verification_interval_months IS NULL OR NEW.verification_interval_months <= 0 THEN
      RAISE EXCEPTION 'Для поверки укажите интервал в месяцах больше нуля';
    END IF;
  ELSE
    NEW.verification_interval_months := NULL;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.code_prefix IS DISTINCT FROM OLD.code_prefix
    AND EXISTS (
      SELECT 1
      FROM public.equipment AS e
      WHERE e.nomenclature_id = OLD.id
    )
    AND current_setting('inventory.prefix_rename', true) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Смена префикса при уже выданных кодах выполняется функцией rename_nomenclature_prefix';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.nomenclature_after_insert_counter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.code_counters (prefix, last_number)
  VALUES (NEW.code_prefix, public.prefix_high_water(NEW.code_prefix))
  ON CONFLICT (prefix) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.locations_blank_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.kind IS NOT NULL AND btrim(NEW.kind) = '' THEN
    NEW.kind := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS locations_blank_kind ON public.locations;
CREATE TRIGGER locations_blank_kind
  BEFORE INSERT OR UPDATE OF kind ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.locations_blank_kind();

CREATE OR REPLACE FUNCTION public.equipment_before_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_requires boolean;
  v_num integer;
  v_archived boolean;
  v_guard integer := 0;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.code IS DISTINCT FROM OLD.code
      AND current_setting('inventory.allow_code_rewrite', true) IS DISTINCT FROM '1' THEN
      RAISE EXCEPTION 'Код единицы нельзя изменить';
    END IF;
    IF NEW.nomenclature_id IS DISTINCT FROM OLD.nomenclature_id THEN
      RAISE EXCEPTION 'Номенклатуру единицы нельзя изменить';
    END IF;

    SELECT n.requires_verification
    INTO v_requires
    FROM public.nomenclature AS n
    WHERE n.id = NEW.nomenclature_id;
  ELSE
    SELECT n.code_prefix, n.requires_verification
    INTO v_prefix, v_requires
    FROM public.nomenclature AS n
    WHERE n.id = NEW.nomenclature_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Номенклатура не найдена';
  END IF;

  IF NOT COALESCE(v_requires, false) THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.last_verification_date IS NOT NULL OR NEW.next_verification_date IS NOT NULL THEN
        RAISE EXCEPTION 'Поля поверки доступны только если номенклатура требует поверки';
      END IF;
    ELSIF (
      NEW.last_verification_date IS DISTINCT FROM OLD.last_verification_date
      OR NEW.next_verification_date IS DISTINCT FROM OLD.next_verification_date
    )
    AND (
      NEW.last_verification_date IS NOT NULL
      OR NEW.next_verification_date IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Поля поверки доступны только если номенклатура требует поверки';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.location_id IS NULL THEN
    RAISE EXCEPTION 'Укажите место установки';
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.location_id IS NULL
    AND current_setting('inventory.allow_code_rewrite', true) IS DISTINCT FROM '1'
    AND (
      NEW.location_id IS DISTINCT FROM OLD.location_id
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.serial_number IS DISTINCT FROM OLD.serial_number
      OR NEW.inventory_number IS DISTINCT FROM OLD.inventory_number
      OR NEW.notes IS DISTINCT FROM OLD.notes
      OR NEW.last_verification_date IS DISTINCT FROM OLD.last_verification_date
      OR NEW.next_verification_date IS DISTINCT FROM OLD.next_verification_date
    ) THEN
    RAISE EXCEPTION 'Укажите место установки';
  END IF;

  IF NEW.location_id IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.location_id IS DISTINCT FROM OLD.location_id) THEN
    SELECT l.is_archived
    INTO v_archived
    FROM public.locations AS l
    WHERE l.id = NEW.location_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Место установки не найдено';
    END IF;
    IF v_archived THEN
      RAISE EXCEPTION 'Архивное место нельзя назначить';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    LOOP
      v_guard := v_guard + 1;
      IF v_guard > 10000 THEN
        RAISE EXCEPTION 'Не удалось выдать свободный код для префикса %', v_prefix;
      END IF;

      INSERT INTO public.code_counters AS c (prefix, last_number)
      VALUES (v_prefix, 1)
      ON CONFLICT (prefix) DO UPDATE
        SET last_number = c.last_number + 1
      RETURNING last_number INTO v_num;

      IF v_num < 1000 THEN
        NEW.code := v_prefix || '-' || lpad(v_num::text, 3, '0');
      ELSE
        NEW.code := v_prefix || '-' || v_num::text;
      END IF;

      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.equipment_former_codes AS former
        WHERE former.code = NEW.code
      ) AND NOT EXISTS (
        SELECT 1
        FROM public.equipment AS taken
        WHERE taken.code = NEW.code
      );
    END LOOP;
  END IF;

  IF NEW.serial_number IS NOT NULL AND btrim(NEW.serial_number) = '' THEN
    NEW.serial_number := NULL;
  END IF;
  IF NEW.inventory_number IS NOT NULL AND btrim(NEW.inventory_number) = '' THEN
    NEW.inventory_number := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rename_nomenclature_prefix(p_id uuid, p_prefix text)
RETURNS TABLE (equipment_id uuid, old_code text, new_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old text;
  v_new text;
  v_row record;
  v_suffix text;
  v_num integer;
  v_code text;
  v_plan jsonb := '[]'::jsonb;
  v_item jsonb;
BEGIN
  IF public.current_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Недостаточно прав для смены префикса';
  END IF;

  v_new := upper(btrim(COALESCE(p_prefix, '')));
  IF v_new !~ '^[A-Z0-9]{2,8}$' THEN
    RAISE EXCEPTION 'Префикс: от 2 до 8 символов, только A–Z и цифры';
  END IF;

  SELECT n.code_prefix
  INTO v_old
  FROM public.nomenclature AS n
  WHERE n.id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Номенклатура не найдена';
  END IF;

  IF v_old = v_new THEN
    RAISE EXCEPTION 'Префикс не изменился';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.nomenclature AS n
    WHERE n.code_prefix = v_new
      AND n.id <> p_id
  ) THEN
    RAISE EXCEPTION 'Такой префикс уже занят';
  END IF;

  FOR v_row IN
    SELECT e.id, e.code
    FROM public.equipment AS e
    WHERE e.nomenclature_id = p_id
    ORDER BY e.code
    FOR UPDATE
  LOOP
    IF v_row.code !~ '^[A-Z0-9]{2,8}-[0-9]+$' THEN
      RAISE EXCEPTION 'Код % нельзя переименовать', v_row.code;
    END IF;

    v_suffix := substring(v_row.code FROM '-([0-9]+)$');
    v_num := v_suffix::integer;
    IF v_num < 1000 THEN
      v_code := v_new || '-' || lpad(v_num::text, 3, '0');
    ELSE
      v_code := v_new || '-' || v_num::text;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.equipment AS other
      WHERE other.code = v_code
        AND other.id <> v_row.id
    ) THEN
      RAISE EXCEPTION 'Код % уже занят другой единицей', v_code;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.equipment_former_codes AS former
      WHERE former.code = v_code
        AND former.equipment_id <> v_row.id
    ) THEN
      RAISE EXCEPTION 'Код % уже использовался и не выдаётся повторно', v_code;
    END IF;

    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'id', v_row.id,
      'old', v_row.code,
      'new', v_code
    ));
  END LOOP;

  DELETE FROM public.equipment_former_codes AS former
  USING jsonb_array_elements(v_plan) AS item
  WHERE former.code = item->>'new'
    AND former.equipment_id = (item->>'id')::uuid;

  INSERT INTO public.equipment_former_codes (code, equipment_id)
  SELECT item->>'old', (item->>'id')::uuid
  FROM jsonb_array_elements(v_plan) AS item
  WHERE item->>'old' IS DISTINCT FROM item->>'new';

  PERFORM set_config('inventory.allow_code_rewrite', '1', true);
  PERFORM set_config('inventory.prefix_rename', '1', true);

  UPDATE public.equipment AS e
  SET code = item->>'new'
  FROM jsonb_array_elements(v_plan) AS item
  WHERE e.id = (item->>'id')::uuid
    AND e.code IS DISTINCT FROM item->>'new';

  UPDATE public.nomenclature
  SET code_prefix = v_new
  WHERE id = p_id;

  PERFORM set_config('inventory.allow_code_rewrite', '', true);
  PERFORM set_config('inventory.prefix_rename', '', true);

  RETURN QUERY
  SELECT (item->>'id')::uuid, item->>'old', item->>'new'
  FROM jsonb_array_elements(v_plan) AS item
  ORDER BY item->>'new';
END;
$$;

COMMENT ON FUNCTION public.rename_nomenclature_prefix(uuid, text) IS
  'Меняет префикс и коды всех единиц этой номенклатуры в одной транзакции. Номера сохраняются, старые коды остаются занятыми. Только admin.';

CREATE OR REPLACE FUNCTION public.insert_location_above(anchor_id uuid, place_name text)
RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent uuid;
  v_name text;
  v_id uuid;
BEGIN
  IF public.current_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения мест';
  END IF;

  v_name := btrim(COALESCE(place_name, ''));
  IF v_name = '' OR position('→' IN v_name) > 0 THEN
    RAISE EXCEPTION 'Укажите название без знака «→»';
  END IF;

  SELECT l.parent_id
  INTO v_parent
  FROM public.locations AS l
  WHERE l.id = anchor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Место не найдено';
  END IF;

  INSERT INTO public.locations (parent_id, name)
  VALUES (v_parent, v_name)
  RETURNING id INTO v_id;

  UPDATE public.locations
  SET parent_id = v_id
  WHERE id = anchor_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.insert_location_above(uuid, text) IS
  'Вставляет новое место между узлом и его родителем. Цикл и архивный родитель отвергаются. Только admin.';

REVOKE ALL ON FUNCTION public.prefix_high_water(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nomenclature_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nomenclature_after_insert_counter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.locations_blank_kind() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.equipment_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rename_nomenclature_prefix(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.insert_location_above(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rename_nomenclature_prefix(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_location_above(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_locations(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_ord integer := 0;
  v_row integer;
  v_name text;
  v_kind text;
  v_parent text;
  v_full text;
  v_responsible text;
  v_errors text[] := ARRAY[]::text[];
  v_pending jsonb := '[]'::jsonb;
  v_next jsonb;
  v_known jsonb := '{}'::jsonb;
  v_progress boolean;
  v_guard integer := 0;
  v_parent_id uuid;
  v_employee uuid;
  v_employee_count integer;
  v_id uuid;
  v_created integer := 0;
  v_left text;
BEGIN
  PERFORM public.excel_import_guard(p_rows);

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT public.location_full_path(l.id) AS path
      FROM public.locations AS l
      WHERE public.location_full_path(l.id) IS NOT NULL
    ) AS paths
    GROUP BY path
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'В справочнике есть места с одинаковым полным путём. Импорт остановлен, файл не записан';
  END IF;

  SELECT COALESCE(
    jsonb_object_agg(
      public.location_full_path(l.id),
      jsonb_build_object('id', l.id, 'archived', l.is_archived)
    ),
    '{}'::jsonb
  )
  INTO v_known
  FROM public.locations AS l
  WHERE public.location_full_path(l.id) IS NOT NULL;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_rows)
  LOOP
    v_ord := v_ord + 1;
    v_row := CASE
      WHEN jsonb_typeof(v_item) = 'object'
        AND jsonb_typeof(v_item->'row') = 'number'
        THEN (v_item->>'row')::integer
      ELSE v_ord + 1
    END;

    IF jsonb_typeof(v_item) <> 'object' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: ожидалась запись', v_row));
      END IF;
      CONTINUE;
    END IF;

    v_name := btrim(COALESCE(v_item->>'name', ''));
    v_kind := btrim(COALESCE(v_item->>'kind', ''));
    v_parent := btrim(COALESCE(v_item->>'parent_path', ''));
    v_parent := regexp_replace(v_parent, '\s*->\s*', ' → ', 'g');
    v_parent := regexp_replace(v_parent, '\s*→\s*', ' → ', 'g');
    v_parent := btrim(v_parent);
    v_responsible := btrim(COALESCE(v_item->>'responsible_name', ''));

    IF v_name = '' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: не заполнено название', v_row));
      END IF;
    ELSIF position('→' IN v_name) > 0 THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: в названии нельзя использовать знак «→»', v_row));
      END IF;
    END IF;

    IF v_parent = '' THEN
      v_full := v_name;
    ELSE
      v_full := v_parent || ' → ' || v_name;
    END IF;

    IF v_responsible <> '' THEN
      SELECT count(*)
      INTO v_employee_count
      FROM public.employees AS emp
      WHERE NOT emp.is_archived
        AND public.fold_text(emp.full_name) = public.fold_text(v_responsible);

      IF v_employee_count = 0 THEN
        IF cardinality(v_errors) < 40 THEN
          v_errors := array_append(
            v_errors,
            format('Строка %s: сотрудник «%s» не найден среди действующих', v_row, v_responsible)
          );
        END IF;
      ELSIF v_employee_count > 1 THEN
        IF cardinality(v_errors) < 40 THEN
          v_errors := array_append(
            v_errors,
            format('Строка %s: несколько сотрудников с ФИО «%s»', v_row, v_responsible)
          );
        END IF;
      END IF;
    END IF;

    IF v_parent <> ''
      AND v_known ? v_parent
      AND COALESCE((v_known->v_parent->>'archived')::boolean, false) THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(
          v_errors,
          format('Строка %s: родитель «%s» в архиве', v_row, v_parent)
        );
      END IF;
    END IF;

    v_pending := v_pending || jsonb_build_array(jsonb_build_object(
      'row', v_row,
      'name', v_name,
      'kind', v_kind,
      'parent_path', v_parent,
      'full_path', v_full,
      'responsible_name', v_responsible
    ));
  END LOOP;

  IF cardinality(v_errors) > 0 THEN
    RAISE EXCEPTION '%', array_to_string(v_errors, E'\n');
  END IF;

  WHILE jsonb_array_length(v_pending) > 0 LOOP
    v_guard := v_guard + 1;
    IF v_guard > 2001 THEN
      RAISE EXCEPTION 'Не удалось разобрать иерархию мест. Файл не записан';
    END IF;

    v_progress := false;
    v_next := '[]'::jsonb;

    FOR v_item IN
      SELECT value
      FROM jsonb_array_elements(v_pending)
    LOOP
      v_parent := v_item->>'parent_path';
      v_full := v_item->>'full_path';
      v_row := (v_item->>'row')::integer;
      v_name := v_item->>'name';
      v_kind := v_item->>'kind';
      v_responsible := COALESCE(v_item->>'responsible_name', '');

      IF v_parent <> '' AND NOT (v_known ? v_parent) THEN
        v_next := v_next || jsonb_build_array(v_item);
        CONTINUE;
      END IF;

      IF v_known ? v_full THEN
        RAISE EXCEPTION '%', format(
          'Строка %s: место «%s» уже есть. Файл не записан',
          v_row,
          v_full
        );
      END IF;

      v_parent_id := NULL;
      IF v_parent <> '' THEN
        v_parent_id := (v_known->v_parent->>'id')::uuid;
      END IF;

      v_employee := NULL;
      IF v_responsible <> '' THEN
        SELECT emp.id
        INTO v_employee
        FROM public.employees AS emp
        WHERE NOT emp.is_archived
          AND public.fold_text(emp.full_name) = public.fold_text(v_responsible)
        LIMIT 1;
      END IF;

      INSERT INTO public.locations (parent_id, name, kind, responsible_employee_id)
      VALUES (v_parent_id, v_name, NULLIF(v_kind, ''), v_employee)
      RETURNING id INTO v_id;

      v_known := v_known || jsonb_build_object(
        v_full,
        jsonb_build_object('id', v_id, 'archived', false)
      );
      v_created := v_created + 1;
      v_progress := true;
    END LOOP;

    IF NOT v_progress THEN
      SELECT string_agg(
        format('Строка %s: родитель «%s» не найден', (value->>'row')::integer, value->>'parent_path'),
        E'\n'
        ORDER BY (value->>'row')::integer
      )
      INTO v_left
      FROM jsonb_array_elements(v_pending);
      RAISE EXCEPTION '%', COALESCE(v_left, 'Не удалось разобрать иерархию мест') || E'\nФайл не записан';
    END IF;

    v_pending := v_next;
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,
    'codes', '[]'::jsonb,
    'warnings', '[]'::jsonb
  );
END;
$$;


CREATE OR REPLACE FUNCTION public.import_equipment(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_ord integer := 0;
  v_row integer;
  v_prefix text;
  v_serial text;
  v_inventory text;
  v_status_text text;
  v_status public.equipment_status;
  v_location_path text;
  v_notes text;
  v_last_raw text;
  v_next_raw text;
  v_last date;
  v_next date;
  v_requires boolean;
  v_nomenclature uuid;
  v_location uuid;
  v_errors text[] := ARRAY[]::text[];
  v_ready jsonb := '[]'::jsonb;
  v_known jsonb := '{}'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_seen text[] := ARRAY[]::text[];
  v_codes text[] := ARRAY[]::text[];
  v_code text;
  v_created integer := 0;
  v_archived boolean;
BEGIN
  PERFORM public.excel_import_guard(p_rows);

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT public.location_full_path(l.id) AS path
      FROM public.locations AS l
      WHERE public.location_full_path(l.id) IS NOT NULL
    ) AS paths
    GROUP BY path
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'В справочнике есть места с одинаковым полным путём. Импорт остановлен, файл не записан';
  END IF;

  SELECT COALESCE(
    jsonb_object_agg(
      public.location_full_path(l.id),
      jsonb_build_object('id', l.id, 'archived', l.is_archived)
    ),
    '{}'::jsonb
  )
  INTO v_known
  FROM public.locations AS l
  WHERE public.location_full_path(l.id) IS NOT NULL;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_rows)
  LOOP
    v_ord := v_ord + 1;
    v_row := CASE
      WHEN jsonb_typeof(v_item) = 'object'
        AND jsonb_typeof(v_item->'row') = 'number'
        THEN (v_item->>'row')::integer
      ELSE v_ord + 1
    END;

    IF jsonb_typeof(v_item) <> 'object' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: ожидалась запись', v_row));
      END IF;
      CONTINUE;
    END IF;

    v_prefix := upper(btrim(COALESCE(v_item->>'code_prefix', '')));
    v_serial := NULLIF(btrim(COALESCE(v_item->>'serial_number', '')), '');
    v_inventory := NULLIF(btrim(COALESCE(v_item->>'inventory_number', '')), '');
    v_notes := NULLIF(btrim(COALESCE(v_item->>'notes', '')), '');
    v_location_path := btrim(COALESCE(v_item->>'location_path', ''));
    v_location_path := regexp_replace(v_location_path, '\s*->\s*', ' → ', 'g');
    v_location_path := regexp_replace(v_location_path, '\s*→\s*', ' → ', 'g');
    v_location_path := btrim(v_location_path);
    v_status_text := btrim(COALESCE(v_item->>'status', ''));
    v_status := CASE public.fold_text(v_status_text)
      WHEN 'in_work' THEN 'in_work'::public.equipment_status
      WHEN 'в работе' THEN 'in_work'::public.equipment_status
      WHEN 'on_verification' THEN 'on_verification'::public.equipment_status
      WHEN 'на поверке' THEN 'on_verification'::public.equipment_status
      WHEN 'in_repair' THEN 'in_repair'::public.equipment_status
      WHEN 'в ремонте' THEN 'in_repair'::public.equipment_status
      WHEN 'written_off' THEN 'written_off'::public.equipment_status
      WHEN 'списано' THEN 'written_off'::public.equipment_status
      WHEN 'reserve' THEN 'reserve'::public.equipment_status
      WHEN 'резерв' THEN 'reserve'::public.equipment_status
      ELSE NULL
    END;

    v_requires := NULL;
    v_nomenclature := NULL;
    IF v_prefix = '' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: не заполнен префикс номенклатуры', v_row));
      END IF;
    ELSE
      SELECT n.id, n.requires_verification
      INTO v_nomenclature, v_requires
      FROM public.nomenclature AS n
      WHERE n.code_prefix = v_prefix;

      IF NOT FOUND THEN
        IF cardinality(v_errors) < 40 THEN
          v_errors := array_append(v_errors, format('Строка %s: номенклатура с префиксом «%s» не найдена', v_row, v_prefix));
        END IF;
      END IF;
    END IF;

    IF v_status IS NULL THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(
          v_errors,
          format('Строка %s: статус «%s» не распознан. Допустимо: В работе, На поверке, В ремонте, Списано, Резерв', v_row, v_status_text)
        );
      END IF;
    END IF;

    v_location := NULL;
    v_archived := false;
    IF v_location_path = '' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: не заполнено место установки', v_row));
      END IF;
    ELSIF v_location_path <> '' THEN
      IF NOT (v_known ? v_location_path) THEN
        IF cardinality(v_errors) < 40 THEN
          v_errors := array_append(v_errors, format('Строка %s: место «%s» не найдено', v_row, v_location_path));
        END IF;
      ELSE
        v_archived := COALESCE((v_known->v_location_path->>'archived')::boolean, false);
        IF v_archived THEN
          IF cardinality(v_errors) < 40 THEN
            v_errors := array_append(v_errors, format('Строка %s: архивное место нельзя назначить', v_row));
          END IF;
        ELSE
          v_location := (v_known->v_location_path->>'id')::uuid;
        END IF;
      END IF;
    END IF;

    v_last := NULL;
    v_next := NULL;
    v_last_raw := NULLIF(btrim(COALESCE(v_item->>'last_verification_date', '')), '');
    v_next_raw := NULLIF(btrim(COALESCE(v_item->>'next_verification_date', '')), '');

    IF v_last_raw IS NOT NULL THEN
      BEGIN
        IF v_last_raw !~ '^\d{4}-\d{2}-\d{2}$' THEN
          RAISE EXCEPTION 'format';
        END IF;
        v_last := v_last_raw::date;
      EXCEPTION
        WHEN OTHERS THEN
          IF cardinality(v_errors) < 40 THEN
            v_errors := array_append(v_errors, format('Строка %s: дата последней поверки должна быть в виде ГГГГ-ММ-ДД', v_row));
          END IF;
      END;
    END IF;

    IF v_next_raw IS NOT NULL THEN
      BEGIN
        IF v_next_raw !~ '^\d{4}-\d{2}-\d{2}$' THEN
          RAISE EXCEPTION 'format';
        END IF;
        v_next := v_next_raw::date;
      EXCEPTION
        WHEN OTHERS THEN
          IF cardinality(v_errors) < 40 THEN
            v_errors := array_append(v_errors, format('Строка %s: дата следующей поверки должна быть в виде ГГГГ-ММ-ДД', v_row));
          END IF;
      END;
    END IF;

    IF v_requires IS FALSE AND (v_last IS NOT NULL OR v_next IS NOT NULL) THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(
          v_errors,
          format('Строка %s: даты поверки можно указать только у номенклатуры, которая требует поверки', v_row)
        );
      END IF;
    END IF;

    v_ready := v_ready || jsonb_build_array(jsonb_build_object(
      'row', v_row,
      'code_prefix', v_prefix,
      'nomenclature_id', v_nomenclature,
      'serial_number', v_serial,
      'inventory_number', v_inventory,
      'status', v_status,
      'location_id', v_location,
      'last_verification_date', v_last,
      'next_verification_date', v_next,
      'notes', v_notes
    ));
  END LOOP;

  IF cardinality(v_errors) > 0 THEN
    RAISE EXCEPTION '%', array_to_string(v_errors, E'\n');
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(v_ready)
  LOOP
    v_row := (v_item->>'row')::integer;
    v_prefix := v_item->>'code_prefix';
    v_serial := NULLIF(v_item->>'serial_number', '');
    v_nomenclature := (v_item->>'nomenclature_id')::uuid;

    IF v_serial IS NOT NULL AND (
      public.fold_text(v_serial) = ANY (v_seen)
      OR EXISTS (
        SELECT 1
        FROM public.equipment AS e
        WHERE e.nomenclature_id = v_nomenclature
          AND e.serial_number IS NOT NULL
          AND public.fold_text(e.serial_number) = public.fold_text(v_serial)
      )
    ) THEN
      v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
        'row', v_row,
        'message', format('Серийный номер «%s» уже есть у номенклатуры %s', v_serial, v_prefix)
      ));
    END IF;

    IF v_serial IS NOT NULL THEN
      v_seen := array_append(v_seen, public.fold_text(v_serial));
    END IF;

    BEGIN
      INSERT INTO public.equipment (
        nomenclature_id,
        serial_number,
        inventory_number,
        status,
        location_id,
        last_verification_date,
        next_verification_date,
        notes
      )
      VALUES (
        v_nomenclature,
        v_serial,
        NULLIF(v_item->>'inventory_number', ''),
        (v_item->>'status')::public.equipment_status,
        NULLIF(v_item->>'location_id', '')::uuid,
        NULLIF(v_item->>'last_verification_date', '')::date,
        NULLIF(v_item->>'next_verification_date', '')::date,
        NULLIF(v_item->>'notes', '')
      )
      RETURNING code INTO v_code;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION '%', format('Строка %s: %s. Файл не записан', v_row, SQLERRM);
    END;

    v_codes := array_append(v_codes, v_code);
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,
    'codes', to_jsonb(v_codes),
    'warnings', v_warnings
  );
END;
$$;


COMMENT ON FUNCTION public.import_locations(jsonb) IS
  'Импорт мест одной транзакцией. Вид уровня необязателен. Ошибка откатывает весь файл.';

COMMENT ON FUNCTION public.import_equipment(jsonb) IS
  'Импорт единиц одной транзакцией. Место и статус обязательны. Колонка кода игнорируется.';

REVOKE ALL ON FUNCTION public.import_locations(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_equipment(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_locations(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_equipment(jsonb) TO authenticated;
