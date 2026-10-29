-- Этап 6: импорт Excel. Один вызов — одна транзакция: ошибка откатывает весь файл.
-- Функции не security definer. Вызов только у admin, anon и PUBLIC не исполняют.
-- Код единицы не принимается: его пишет триггер выдачи.

CREATE OR REPLACE FUNCTION public.excel_import_guard(p_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF public.current_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Недостаточно прав для импорта';
  END IF;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Ожидался список строк';
  END IF;

  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'В файле нет строк для импорта';
  END IF;

  IF jsonb_array_length(p_rows) > 2000 THEN
    RAISE EXCEPTION 'За один раз можно импортировать не больше 2000 строк';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.excel_import_guard(jsonb) IS
  'Общая проверка импорта: только admin, массив, не больше 2000 строк.';

CREATE OR REPLACE FUNCTION public.fold_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT translate(
    lower(COALESCE(p_text, '')),
    'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
    'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'
  );
$$;

COMMENT ON FUNCTION public.fold_text(text) IS
  'Сравнение без регистра, включая кириллицу, независимо от локали базы.';

CREATE OR REPLACE FUNCTION public.import_nomenclature(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_ord integer := 0;
  v_row integer;
  v_prefix text;
  v_name text;
  v_manufacturer text;
  v_model text;
  v_category text;
  v_requires boolean;
  v_interval integer;
  v_interval_num numeric;
  v_notes text;
  v_errors text[] := ARRAY[]::text[];
  v_ready jsonb := '[]'::jsonb;
  v_clean jsonb;
  v_created integer := 0;
BEGIN
  PERFORM public.excel_import_guard(p_rows);

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(p_rows)
  LOOP
    v_ord := v_ord + 1;
    v_row := CASE
      WHEN jsonb_typeof(v_item) = 'object'
        AND jsonb_typeof(v_item->'row') = 'number'
        AND (v_item->>'row') ~ '^[0-9]+$'
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
    v_name := btrim(COALESCE(v_item->>'name', ''));
    v_manufacturer := NULLIF(btrim(COALESCE(v_item->>'manufacturer', '')), '');
    v_model := NULLIF(btrim(COALESCE(v_item->>'model', '')), '');
    v_category := NULLIF(btrim(COALESCE(v_item->>'category', '')), '');
    v_notes := NULLIF(btrim(COALESCE(v_item->>'notes', '')), '');

    IF v_prefix !~ '^[A-Z0-9]{2,8}$' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(
          v_errors,
          format('Строка %s: префикс — от 2 до 8 символов, только A–Z и цифры', v_row)
        );
      END IF;
    ELSIF EXISTS (
      SELECT 1
      FROM public.nomenclature AS n
      WHERE n.code_prefix = v_prefix
    ) THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: префикс «%s» уже занят', v_row, v_prefix));
      END IF;
    END IF;

    IF v_name = '' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: не заполнено название', v_row));
      END IF;
    END IF;

    IF jsonb_typeof(v_item->'requires_verification') IS DISTINCT FROM 'boolean' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: укажите, нужна ли поверка', v_row));
      END IF;
      v_requires := false;
    ELSE
      v_requires := (v_item->>'requires_verification')::boolean;
    END IF;

    v_interval := NULL;
    IF v_item->'verification_interval_months' IS NULL
      OR jsonb_typeof(v_item->'verification_interval_months') = 'null' THEN
      v_interval := NULL;
    ELSIF jsonb_typeof(v_item->'verification_interval_months') <> 'number' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: интервал поверки должен быть числом месяцев', v_row));
      END IF;
    ELSE
      v_interval_num := (v_item->>'verification_interval_months')::numeric;
      IF v_interval_num <> trunc(v_interval_num) OR v_interval_num <= 0 OR v_interval_num > 1200 THEN
        IF cardinality(v_errors) < 40 THEN
          v_errors := array_append(
            v_errors,
            format('Строка %s: интервал поверки — целое число месяцев больше нуля', v_row)
          );
        END IF;
      ELSE
        v_interval := v_interval_num::integer;
      END IF;
    END IF;

    IF v_requires AND v_interval IS NULL AND jsonb_typeof(v_item->'requires_verification') = 'boolean' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(
          v_errors,
          format('Строка %s: при включённой поверке укажите интервал в месяцах', v_row)
        );
      END IF;
    ELSIF NOT v_requires AND v_interval IS NOT NULL THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(
          v_errors,
          format('Строка %s: интервал указывают только если поверка нужна', v_row)
        );
      END IF;
    END IF;

    v_clean := jsonb_build_object(
      'row', v_row,
      'code_prefix', v_prefix,
      'name', v_name,
      'manufacturer', v_manufacturer,
      'model', v_model,
      'category', v_category,
      'requires_verification', v_requires,
      'verification_interval_months', v_interval,
      'notes', v_notes
    );
    v_ready := v_ready || jsonb_build_array(v_clean);
  END LOOP;

  IF cardinality(v_errors) > 0 THEN
    RAISE EXCEPTION '%', array_to_string(v_errors, E'\n');
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(v_ready)
  LOOP
    v_prefix := v_item->>'code_prefix';
    v_row := (v_item->>'row')::integer;
    IF EXISTS (
      SELECT 1
      FROM public.nomenclature AS n
      WHERE n.code_prefix = v_prefix
    ) THEN
      RAISE EXCEPTION '%', format(
        'Строка %s: префикс «%s» уже занят. Файл не записан',
        v_row,
        v_prefix
      );
    END IF;

    INSERT INTO public.nomenclature (
      code_prefix,
      name,
      manufacturer,
      model,
      category,
      requires_verification,
      verification_interval_months,
      notes
    )
    VALUES (
      v_prefix,
      v_item->>'name',
      v_item->>'manufacturer',
      v_item->>'model',
      v_item->>'category',
      (v_item->>'requires_verification')::boolean,
      NULLIF(v_item->>'verification_interval_months', '')::integer,
      v_item->>'notes'
    );
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,
    'codes', '[]'::jsonb,
    'warnings', '[]'::jsonb
  );
END;
$$;

COMMENT ON FUNCTION public.import_nomenclature(jsonb) IS
  'Импорт номенклатуры одной транзакцией. Повтор префикса внутри файла откатывает уже вставленные строки.';

CREATE OR REPLACE FUNCTION public.import_employees(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_ord integer := 0;
  v_row integer;
  v_name text;
  v_position text;
  v_phone text;
  v_errors text[] := ARRAY[]::text[];
  v_ready jsonb := '[]'::jsonb;
  v_created integer := 0;
BEGIN
  PERFORM public.excel_import_guard(p_rows);

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

    v_name := btrim(COALESCE(v_item->>'full_name', ''));
    v_position := NULLIF(btrim(COALESCE(v_item->>'position', '')), '');
    v_phone := NULLIF(btrim(COALESCE(v_item->>'phone', '')), '');

    IF v_name = '' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: не заполнено ФИО', v_row));
      END IF;
    END IF;

    v_ready := v_ready || jsonb_build_array(jsonb_build_object(
      'row', v_row,
      'full_name', v_name,
      'position', v_position,
      'phone', v_phone
    ));
  END LOOP;

  IF cardinality(v_errors) > 0 THEN
    RAISE EXCEPTION '%', array_to_string(v_errors, E'\n');
  END IF;

  FOR v_item IN
    SELECT value
    FROM jsonb_array_elements(v_ready)
  LOOP
    INSERT INTO public.employees (full_name, position, phone)
    VALUES (v_item->>'full_name', v_item->>'position', v_item->>'phone');
    v_created := v_created + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,
    'codes', '[]'::jsonb,
    'warnings', '[]'::jsonb
  );
END;
$$;

COMMENT ON FUNCTION public.import_employees(jsonb) IS
  'Импорт сотрудников одной транзакцией. Создаёт новые карточки, существующие не обновляет.';

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

    IF v_kind = '' THEN
      IF cardinality(v_errors) < 40 THEN
        v_errors := array_append(v_errors, format('Строка %s: не заполнен вид места', v_row));
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
      VALUES (v_parent_id, v_name, v_kind, v_employee)
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

COMMENT ON FUNCTION public.import_locations(jsonb) IS
  'Импорт мест одной транзакцией. Родитель — полный путь, в том числе из этого же файла. Ошибка откатывает весь файл.';

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
    IF v_location_path <> '' THEN
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

COMMENT ON FUNCTION public.import_equipment(jsonb) IS
  'Импорт единиц одной транзакцией. Колонка кода игнорируется: номер выдаёт база. Дубль серийного номера — предупреждение, не ошибка.';

REVOKE ALL ON FUNCTION public.excel_import_guard(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fold_text(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_nomenclature(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_locations(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_employees(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_equipment(jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.excel_import_guard(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fold_text(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_nomenclature(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_locations(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_employees(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_equipment(jsonb) TO authenticated;
