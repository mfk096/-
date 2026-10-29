-- Этап 3: архив сотрудников, счётчики поддерева, источник ответственного,
-- запрет архивировать занятый узел и RPC переноса без цикла.
-- Идемпотентна. Функции не security definer. anon и PUBLIC не вызывают их через RPC.

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.employees.is_archived IS
  'Архивный сотрудник не назначается ответственным заново. Уже указанные места сохраняют ссылку.';

CREATE INDEX IF NOT EXISTS employees_is_archived_idx ON public.employees (is_archived);

CREATE OR REPLACE FUNCTION public.location_responsible_source(p_location_id uuid)
RETURNS TABLE (employee_id uuid, source_location_id uuid)
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
  SELECT chain.responsible_employee_id, chain.id
  FROM chain
  WHERE chain.responsible_employee_id IS NOT NULL
  ORDER BY chain.depth
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.location_responsible_source(uuid) IS
  'Свой или унаследованный ответственный и узел, с которого он взят. В строку места не копируется.';

CREATE OR REPLACE FUNCTION public.locations_reject_busy_archive()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_children integer;
  v_units integer;
BEGIN
  IF TG_OP <> 'UPDATE' OR NOT NEW.is_archived OR OLD.is_archived THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
  INTO v_children
  FROM public.locations AS child
  WHERE child.parent_id = NEW.id;

  SELECT count(*)
  INTO v_units
  FROM public.equipment AS e
  WHERE e.location_id = NEW.id;

  IF v_children > 0 AND v_units > 0 THEN
    RAISE EXCEPTION
      'Нельзя архивировать место «%»: сначала перенесите вложенные места (%) и единицы (%).',
      NEW.name, v_children, v_units;
  ELSIF v_children > 0 THEN
    RAISE EXCEPTION
      'Нельзя архивировать место «%»: сначала перенесите вложенные места (%).',
      NEW.name, v_children;
  ELSIF v_units > 0 THEN
    RAISE EXCEPTION
      'Нельзя архивировать место «%»: сначала перенесите единицы (%).',
      NEW.name, v_units;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.locations_reject_busy_archive() IS
  'Архив места только после переноса вложенных узлов и единиц, которые стоят прямо в нём.';

DROP TRIGGER IF EXISTS locations_reject_busy_archive ON public.locations;
CREATE TRIGGER locations_reject_busy_archive
  BEFORE UPDATE OF is_archived ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.locations_reject_busy_archive();

CREATE OR REPLACE FUNCTION public.locations_reject_archived_parent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_archived boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id THEN
    RETURN NEW;
  END IF;

  SELECT l.name, l.is_archived
  INTO v_name, v_archived
  FROM public.locations AS l
  WHERE l.id = NEW.parent_id;

  IF FOUND AND v_archived THEN
    RAISE EXCEPTION 'Нельзя поместить место внутрь архивного узла «%».', v_name;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.locations_reject_archived_parent() IS
  'Новый узел и перенос не попадают внутрь архивного места.';

DROP TRIGGER IF EXISTS locations_reject_archived_parent ON public.locations;
CREATE TRIGGER locations_reject_archived_parent
  BEFORE INSERT OR UPDATE OF parent_id ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.locations_reject_archived_parent();

CREATE OR REPLACE FUNCTION public.locations_reject_archived_responsible()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_archived boolean;
BEGIN
  IF NEW.responsible_employee_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
    AND NEW.responsible_employee_id IS NOT DISTINCT FROM OLD.responsible_employee_id THEN
    RETURN NEW;
  END IF;

  SELECT e.is_archived
  INTO v_archived
  FROM public.employees AS e
  WHERE e.id = NEW.responsible_employee_id;

  IF FOUND AND v_archived THEN
    RAISE EXCEPTION 'Нельзя назначить архивного сотрудника ответственным.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.locations_reject_archived_responsible() IS
  'Новое назначение ответственного не принимает архивного сотрудника. Уже стоящая ссылка сохраняется.';

DROP TRIGGER IF EXISTS locations_reject_archived_responsible ON public.locations;
CREATE TRIGGER locations_reject_archived_responsible
  BEFORE INSERT OR UPDATE OF responsible_employee_id ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.locations_reject_archived_responsible();

CREATE OR REPLACE FUNCTION public.employees_prevent_referenced_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*)
  INTO v_count
  FROM public.locations AS l
  WHERE l.responsible_employee_id = OLD.id;

  IF v_count > 0 THEN
    RAISE EXCEPTION
      'Нельзя удалить сотрудника «%»: на него ссылаются места (%). Архивируйте карточку.',
      OLD.full_name, v_count;
  END IF;

  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.employees_prevent_referenced_delete() IS
  'Удаление сотрудника со ссылками из мест запрещено. Вместо этого карточку архивируют.';

DROP TRIGGER IF EXISTS employees_prevent_referenced_delete ON public.employees;
CREATE TRIGGER employees_prevent_referenced_delete
  BEFORE DELETE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.employees_prevent_referenced_delete();

CREATE OR REPLACE FUNCTION public.move_location(
  location_id uuid,
  new_parent_id uuid
)
RETURNS public.locations
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row public.locations;
  v_role public.app_role;
BEGIN
  v_role := public.current_role();
  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Недостаточно прав для изменения мест';
  END IF;

  SELECT l.*
  INTO v_row
  FROM public.locations AS l
  WHERE l.id = move_location.location_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Место не найдено';
  END IF;

  IF v_row.parent_id IS NOT DISTINCT FROM move_location.new_parent_id THEN
    RAISE EXCEPTION 'Родитель не изменился';
  END IF;

  IF move_location.new_parent_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.locations AS parent
      WHERE parent.id = move_location.new_parent_id
    ) THEN
    RAISE EXCEPTION 'Новый родитель не найден';
  END IF;

  IF move_location.new_parent_id IS NOT NULL THEN
    IF move_location.new_parent_id = move_location.location_id THEN
      RAISE EXCEPTION 'Нельзя перенести место внутрь самого себя';
    END IF;

    IF EXISTS (
      WITH RECURSIVE sub AS (
        SELECT child.id, 0 AS depth
        FROM public.locations AS child
        WHERE child.parent_id = move_location.location_id
        UNION ALL
        SELECT next_child.id, sub.depth + 1
        FROM public.locations AS next_child
        JOIN sub ON next_child.parent_id = sub.id
        WHERE sub.depth < 100
      )
      SELECT 1
      FROM sub
      WHERE sub.id = move_location.new_parent_id
    ) THEN
      RAISE EXCEPTION 'Нельзя перенести место внутрь вложенного узла: получится цикл';
    END IF;
  END IF;

  UPDATE public.locations AS l
  SET parent_id = move_location.new_parent_id
  WHERE l.id = move_location.location_id
  RETURNING l.* INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Место не найдено или нет прав на изменение';
  END IF;

  RETURN v_row;
END;
$$;

COMMENT ON FUNCTION public.move_location(uuid, uuid) IS
  'Перенос узла к другому родителю или в корень. Цикл и архивный родитель отвергаются. Только admin.';

CREATE OR REPLACE VIEW public.locations_with_path
WITH (security_invoker = true) AS
WITH RECURSIVE descendants AS (
  SELECT
    l.id AS ancestor_id,
    l.id AS descendant_id,
    0 AS depth
  FROM public.locations AS l
  UNION ALL
  SELECT
    descendants.ancestor_id,
    child.id,
    descendants.depth + 1
  FROM descendants
  JOIN public.locations AS child ON child.parent_id = descendants.descendant_id
  WHERE descendants.depth < 100
),
subtree_counts AS (
  SELECT
    descendants.ancestor_id AS location_id,
    count(e.id)::bigint AS equipment_count
  FROM descendants
  LEFT JOIN public.equipment AS e ON e.location_id = descendants.descendant_id
  GROUP BY descendants.ancestor_id
)
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
  src.employee_id AS effective_responsible_employee_id,
  emp.full_name AS effective_responsible_name,
  src.source_location_id AS responsible_source_location_id,
  source_loc.name AS responsible_source_name,
  (
    src.source_location_id IS NOT NULL
    AND src.source_location_id IS DISTINCT FROM l.id
  ) AS responsible_is_inherited,
  COALESCE(emp.is_archived, false) AS effective_responsible_archived,
  COALESCE(subtree_counts.equipment_count, 0) AS equipment_count,
  (
    SELECT count(*)::bigint
    FROM public.equipment AS placed
    WHERE placed.location_id = l.id
  ) AS direct_equipment_count,
  (
    SELECT count(*)::bigint
    FROM public.locations AS child
    WHERE child.parent_id = l.id
  ) AS child_count
FROM public.locations AS l
LEFT JOIN LATERAL public.location_responsible_source(l.id) AS src ON true
LEFT JOIN public.employees AS emp ON emp.id = src.employee_id
LEFT JOIN public.locations AS source_loc ON source_loc.id = src.source_location_id
LEFT JOIN subtree_counts ON subtree_counts.location_id = l.id;

COMMENT ON VIEW public.locations_with_path IS
  'Места с путём, ответственным, пометкой наследования и числом единиц в поддереве. security_invoker.';

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
  public.location_full_path(e.location_id) AS location_path,
  resp.full_name AS location_responsible_name,
  (
    src.source_location_id IS NOT NULL
    AND src.source_location_id IS DISTINCT FROM e.location_id
  ) AS location_responsible_inherited,
  source_loc.name AS location_responsible_source_name
FROM public.equipment AS e
JOIN public.nomenclature AS n ON n.id = e.nomenclature_id
LEFT JOIN LATERAL public.location_responsible_source(e.location_id) AS src ON true
LEFT JOIN public.employees AS resp ON resp.id = src.employee_id
LEFT JOIN public.locations AS source_loc ON source_loc.id = src.source_location_id;

COMMENT ON VIEW public.equipment_list IS
  'Единица вместе с номенклатурой, путём места и ответственным. security_invoker.';

CREATE OR REPLACE VIEW public.employees_directory
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.full_name,
  e.position,
  e.phone,
  e.profile_id,
  e.is_archived,
  e.created_at,
  e.updated_at,
  p.full_name AS profile_name,
  (
    SELECT count(*)::bigint
    FROM public.locations AS l
    WHERE l.responsible_employee_id = e.id
  ) AS location_count
FROM public.employees AS e
LEFT JOIN public.profiles AS p ON p.id = e.profile_id;

COMMENT ON VIEW public.employees_directory IS
  'Сотрудники, имя связанного профиля и число мест, где они указаны ответственными. security_invoker.';

REVOKE ALL ON TABLE public.employees_directory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.employees_directory TO authenticated;

GRANT SELECT ON public.locations_with_path TO authenticated;
GRANT SELECT ON public.equipment_list TO authenticated;

REVOKE ALL ON FUNCTION public.location_responsible_source(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_location(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.locations_reject_busy_archive() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.locations_reject_archived_parent() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.locations_reject_archived_responsible() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employees_prevent_referenced_delete() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.location_responsible_source(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_location(uuid, uuid) TO authenticated;
