-- Выдача кодов, запрет удаления единиц, неизменность кода и номенклатуры.

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

  IF TG_OP = 'UPDATE' AND NEW.code_prefix IS DISTINCT FROM OLD.code_prefix THEN
    IF EXISTS (
      SELECT 1
      FROM public.equipment AS e
      WHERE e.nomenclature_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'Префикс нельзя изменить: по этой номенклатуре уже есть единицы';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER nomenclature_before_write
  BEFORE INSERT OR UPDATE ON public.nomenclature
  FOR EACH ROW
  EXECUTE FUNCTION public.nomenclature_before_write();

CREATE OR REPLACE FUNCTION public.nomenclature_after_insert_counter()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.code_counters (prefix, last_number)
  VALUES (NEW.code_prefix, 0)
  ON CONFLICT (prefix) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER nomenclature_after_insert_counter
  AFTER INSERT ON public.nomenclature
  FOR EACH ROW
  EXECUTE FUNCTION public.nomenclature_after_insert_counter();

CREATE OR REPLACE FUNCTION public.code_counters_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.last_number > 0 THEN
      RAISE EXCEPTION 'Счётчик с выданными номерами нельзя удалить';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.last_number < OLD.last_number THEN
    RAISE EXCEPTION 'Счётчик кодов нельзя уменьшать';
  END IF;

  IF NEW.prefix IS DISTINCT FROM OLD.prefix AND NEW.last_number IS DISTINCT FROM OLD.last_number THEN
    RAISE EXCEPTION 'Префикс счётчика и номер нельзя менять одновременно';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER code_counters_guard
  BEFORE UPDATE OR DELETE ON public.code_counters
  FOR EACH ROW
  EXECUTE FUNCTION public.code_counters_guard();

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
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.code IS DISTINCT FROM OLD.code THEN
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

CREATE TRIGGER equipment_before_write
  BEFORE INSERT OR UPDATE ON public.equipment
  FOR EACH ROW
  EXECUTE FUNCTION public.equipment_before_write();

CREATE OR REPLACE FUNCTION public.forbid_equipment_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Единицу нельзя удалить. Выбытие — это статус «Списано»';
END;
$$;

CREATE TRIGGER equipment_forbid_delete
  BEFORE DELETE ON public.equipment
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_equipment_delete();
