-- Поверки только у номенклатуры с флагом. Вставка обновляет даты на единице.

CREATE OR REPLACE FUNCTION public.verifications_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_requires boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Поверка записывается от имени вошедшего пользователя';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.equipment_id IS DISTINCT FROM OLD.equipment_id THEN
    RAISE EXCEPTION 'Нельзя перенести запись поверки на другую единицу';
  END IF;

  SELECT n.requires_verification
  INTO v_requires
  FROM public.equipment AS e
  JOIN public.nomenclature AS n ON n.id = e.nomenclature_id
  WHERE e.id = NEW.equipment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Единица не найдена';
  END IF;

  IF NOT v_requires THEN
    RAISE EXCEPTION 'Поверка недоступна: номенклатура не требует поверки';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER verifications_before_write
  BEFORE INSERT OR UPDATE ON public.verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.verifications_before_write();

CREATE TRIGGER verifications_forbid_delete
  BEFORE DELETE ON public.verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_history_delete();

CREATE OR REPLACE FUNCTION public.verifications_after_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_last date;
  v_next date;
BEGIN
  SELECT v.verified_at::date, v.next_due_at
  INTO v_last, v_next
  FROM public.verifications AS v
  WHERE v.equipment_id = NEW.equipment_id
  ORDER BY v.verified_at DESC, v.id DESC
  LIMIT 1;

  UPDATE public.equipment AS e
  SET
    last_verification_date = v_last,
    next_verification_date = v_next
  WHERE e.id = NEW.equipment_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER verifications_after_write
  AFTER INSERT OR UPDATE ON public.verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.verifications_after_write();
