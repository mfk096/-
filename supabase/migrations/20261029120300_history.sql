-- История перемещений и статусов. Комментарий передаётся через RPC в переменную транзакции.

CREATE OR REPLACE FUNCTION public.forbid_history_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Запись истории нельзя удалить';
END;
$$;

CREATE OR REPLACE FUNCTION public.movements_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Перемещение записывается от имени вошедшего пользователя';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.moved_by := v_actor;
    NEW.moved_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NEW.equipment_id IS DISTINCT FROM OLD.equipment_id
    OR NEW.from_location_id IS DISTINCT FROM OLD.from_location_id
    OR NEW.to_location_id IS DISTINCT FROM OLD.to_location_id
    OR NEW.moved_by IS DISTINCT FROM OLD.moved_by
    OR NEW.moved_at IS DISTINCT FROM OLD.moved_at THEN
    RAISE EXCEPTION 'В истории перемещений можно изменить только комментарий';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER movements_before_write
  BEFORE INSERT OR UPDATE ON public.movements
  FOR EACH ROW
  EXECUTE FUNCTION public.movements_before_write();

CREATE TRIGGER movements_forbid_delete
  BEFORE DELETE ON public.movements
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_history_delete();

CREATE OR REPLACE FUNCTION public.status_changes_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Смена статуса записывается от имени вошедшего пользователя';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.changed_by := v_actor;
    NEW.changed_at := clock_timestamp();
    RETURN NEW;
  END IF;

  IF NEW.equipment_id IS DISTINCT FROM OLD.equipment_id
    OR NEW.from_status IS DISTINCT FROM OLD.from_status
    OR NEW.to_status IS DISTINCT FROM OLD.to_status
    OR NEW.changed_by IS DISTINCT FROM OLD.changed_by
    OR NEW.changed_at IS DISTINCT FROM OLD.changed_at THEN
    RAISE EXCEPTION 'В истории статусов можно изменить только комментарий';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER status_changes_before_write
  BEFORE INSERT OR UPDATE ON public.status_changes
  FOR EACH ROW
  EXECUTE FUNCTION public.status_changes_before_write();

CREATE TRIGGER status_changes_forbid_delete
  BEFORE DELETE ON public.status_changes
  FOR EACH ROW
  EXECUTE FUNCTION public.forbid_history_delete();

CREATE OR REPLACE FUNCTION public.equipment_write_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_comment text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'История пишется от имени вошедшего пользователя';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_comment := NULLIF(btrim(COALESCE(current_setting('app.movement_comment', true), '')), '');
    PERFORM set_config('app.movement_comment', '', true);
    INSERT INTO public.movements (
      equipment_id,
      from_location_id,
      to_location_id,
      moved_at,
      moved_by,
      comment
    )
    VALUES (NEW.id, NULL, NEW.location_id, clock_timestamp(), v_actor, v_comment);

    v_comment := NULLIF(btrim(COALESCE(current_setting('app.status_comment', true), '')), '');
    PERFORM set_config('app.status_comment', '', true);
    INSERT INTO public.status_changes (
      equipment_id,
      from_status,
      to_status,
      changed_at,
      changed_by,
      comment
    )
    VALUES (NEW.id, NULL, NEW.status, clock_timestamp(), v_actor, v_comment);

    RETURN NEW;
  END IF;

  IF NEW.location_id IS DISTINCT FROM OLD.location_id THEN
    v_comment := NULLIF(btrim(COALESCE(current_setting('app.movement_comment', true), '')), '');
    PERFORM set_config('app.movement_comment', '', true);
    INSERT INTO public.movements (
      equipment_id,
      from_location_id,
      to_location_id,
      moved_at,
      moved_by,
      comment
    )
    VALUES (NEW.id, OLD.location_id, NEW.location_id, clock_timestamp(), v_actor, v_comment);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_comment := NULLIF(btrim(COALESCE(current_setting('app.status_comment', true), '')), '');
    PERFORM set_config('app.status_comment', '', true);
    INSERT INTO public.status_changes (
      equipment_id,
      from_status,
      to_status,
      changed_at,
      changed_by,
      comment
    )
    VALUES (NEW.id, OLD.status, NEW.status, clock_timestamp(), v_actor, v_comment);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER equipment_write_history
  AFTER INSERT OR UPDATE ON public.equipment
  FOR EACH ROW
  EXECUTE FUNCTION public.equipment_write_history();

CREATE OR REPLACE FUNCTION public.move_equipment(
  equipment_id uuid,
  to_location_id uuid,
  comment text
)
RETURNS public.equipment
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row public.equipment;
  v_role public.app_role;
BEGIN
  v_role := public.current_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Недостаточно прав для перемещения';
  END IF;

  SELECT e.*
  INTO v_row
  FROM public.equipment AS e
  WHERE e.id = move_equipment.equipment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Единица не найдена или нет прав на изменение';
  END IF;

  IF v_row.location_id IS NOT DISTINCT FROM move_equipment.to_location_id THEN
    RAISE EXCEPTION 'Место не изменилось';
  END IF;

  PERFORM set_config('app.movement_comment', COALESCE(move_equipment.comment, ''), true);

  UPDATE public.equipment AS e
  SET location_id = move_equipment.to_location_id
  WHERE e.id = move_equipment.equipment_id
  RETURNING e.* INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.move_equipment(uuid, uuid, text) IS
  'Перемещение единицы с комментарием. Разрешено при любом статусе.';

CREATE OR REPLACE FUNCTION public.change_equipment_status(
  equipment_id uuid,
  new_status public.equipment_status,
  comment text
)
RETURNS public.equipment
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row public.equipment;
  v_role public.app_role;
BEGIN
  v_role := public.current_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Недостаточно прав для смены статуса';
  END IF;

  SELECT e.*
  INTO v_row
  FROM public.equipment AS e
  WHERE e.id = change_equipment_status.equipment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Единица не найдена или нет прав на изменение';
  END IF;

  IF v_row.status IS NOT DISTINCT FROM change_equipment_status.new_status THEN
    RAISE EXCEPTION 'Статус не изменился';
  END IF;

  PERFORM set_config('app.status_comment', COALESCE(change_equipment_status.comment, ''), true);

  UPDATE public.equipment AS e
  SET status = change_equipment_status.new_status
  WHERE e.id = change_equipment_status.equipment_id
  RETURNING e.* INTO v_row;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.change_equipment_status(uuid, public.equipment_status, text) IS
  'Смена статуса единицы с комментарием в истории.';
