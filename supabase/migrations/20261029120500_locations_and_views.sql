-- Циклы в дереве мест, полный путь, наследуемый ответственный и представления для чтения.

CREATE OR REPLACE FUNCTION public.locations_prevent_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_parent uuid;
  v_next uuid;
  v_seen uuid[] := ARRAY[]::uuid[];
  v_guard integer := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS NOT NULL AND NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Место не может ссылаться само на себя';
  END IF;

  v_parent := NEW.parent_id;
  WHILE v_parent IS NOT NULL LOOP
    IF NEW.id IS NOT NULL AND v_parent = NEW.id THEN
      RAISE EXCEPTION 'Цикл в дереве мест';
    END IF;
    IF v_parent = ANY (v_seen) THEN
      RAISE EXCEPTION 'Цикл в дереве мест';
    END IF;

    v_seen := array_append(v_seen, v_parent);
    v_guard := v_guard + 1;
    IF v_guard > 100 THEN
      RAISE EXCEPTION 'Слишком глубокое дерево мест';
    END IF;

    SELECT l.parent_id
    INTO v_next
    FROM public.locations AS l
    WHERE l.id = v_parent;

    IF NOT FOUND THEN
      EXIT;
    END IF;
    v_parent := v_next;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER locations_prevent_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.locations_prevent_cycle();

CREATE OR REPLACE FUNCTION public.location_full_path(p_location_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT l.id, l.parent_id, l.name, 1 AS depth
    FROM public.locations AS l
    WHERE l.id = p_location_id
    UNION ALL
    SELECT parent.id, parent.parent_id, parent.name, chain.depth + 1
    FROM public.locations AS parent
    JOIN chain ON chain.parent_id = parent.id
    WHERE chain.depth < 100
  )
  SELECT string_agg(chain.name, ' → ' ORDER BY chain.depth DESC)
  FROM chain;
$$;

COMMENT ON FUNCTION public.location_full_path(uuid) IS
  'Полный путь места от корня: Завод → Цех → Участок. NULL, если места нет.';

CREATE OR REPLACE FUNCTION public.effective_responsible_employee_id(p_location_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT
      l.id,
      l.parent_id,
      l.responsible_employee_id,
      0 AS depth
    FROM public.locations AS l
    WHERE l.id = p_location_id
    UNION ALL
    SELECT
      parent.id,
      parent.parent_id,
      parent.responsible_employee_id,
      chain.depth + 1
    FROM public.locations AS parent
    JOIN chain ON parent.id = chain.parent_id
    WHERE chain.responsible_employee_id IS NULL
      AND chain.depth < 100
  )
  SELECT chain.responsible_employee_id
  FROM chain
  WHERE chain.responsible_employee_id IS NOT NULL
  ORDER BY chain.depth
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.effective_responsible_employee_id(uuid) IS
  'Ответственный места или ближайшего предка, у которого он задан. В строку места не копируется.';

CREATE OR REPLACE VIEW public.locations_with_path
WITH (security_invoker = true) AS
SELECT
  l.id,
  l.parent_id,
  l.name,
  l.kind,
  l.responsible_employee_id,
  l.is_archived,
  l.created_at,
  l.updated_at,
  public.location_full_path(l.id) AS full_path,
  public.effective_responsible_employee_id(l.id) AS effective_responsible_employee_id,
  emp.full_name AS effective_responsible_name
FROM public.locations AS l
LEFT JOIN public.employees AS emp
  ON emp.id = public.effective_responsible_employee_id(l.id);

COMMENT ON VIEW public.locations_with_path IS
  'Места с полным путём и эффективным ответственным. security_invoker: действует RLS таблиц.';

CREATE OR REPLACE VIEW public.nomenclature_with_counts
WITH (security_invoker = true) AS
SELECT
  n.id,
  n.code_prefix,
  n.name,
  n.manufacturer,
  n.model,
  n.category,
  n.requires_verification,
  n.verification_interval_months,
  n.notes,
  n.created_at,
  n.updated_at,
  (
    SELECT count(*)
    FROM public.equipment AS e
    WHERE e.nomenclature_id = n.id
  ) AS equipment_count
FROM public.nomenclature AS n;

COMMENT ON VIEW public.nomenclature_with_counts IS 'Номенклатура и число единиц. security_invoker.';

CREATE OR REPLACE VIEW public.equipment_list
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.code,
  e.serial_number,
  e.inventory_number,
  e.status,
  e.location_id,
  e.nomenclature_id,
  e.last_verification_date,
  e.next_verification_date,
  e.notes,
  e.created_at,
  e.updated_at,
  n.name AS nomenclature_name,
  n.code_prefix,
  n.manufacturer,
  n.model,
  n.category,
  n.requires_verification,
  n.verification_interval_months,
  public.location_full_path(e.location_id) AS location_path
FROM public.equipment AS e
JOIN public.nomenclature AS n ON n.id = e.nomenclature_id;

COMMENT ON VIEW public.equipment_list IS 'Единица вместе с номенклатурой и путём места. security_invoker.';

CREATE OR REPLACE VIEW public.movement_history
WITH (security_invoker = true) AS
SELECT
  m.id,
  m.equipment_id,
  m.from_location_id,
  m.to_location_id,
  m.moved_at,
  m.moved_by,
  m.comment,
  public.location_full_path(m.from_location_id) AS from_path,
  public.location_full_path(m.to_location_id) AS to_path,
  p.full_name AS moved_by_name
FROM public.movements AS m
JOIN public.profiles AS p ON p.id = m.moved_by;

CREATE OR REPLACE VIEW public.status_change_history
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.equipment_id,
  s.from_status,
  s.to_status,
  s.changed_at,
  s.changed_by,
  s.comment,
  p.full_name AS changed_by_name
FROM public.status_changes AS s
JOIN public.profiles AS p ON p.id = s.changed_by;
