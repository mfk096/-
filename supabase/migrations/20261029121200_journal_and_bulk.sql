-- Этап 4: общий журнал и массовые перемещения/статусы.
-- Идемпотентна. Новые функции не security definer.
-- anon и PUBLIC не исполняют их: Supabase выдаёт EXECUTE роли anon напрямую,
-- поэтому REVOKE с PUBLIC его не снимает.

CREATE INDEX IF NOT EXISTS movements_moved_at_idx
  ON public.movements (moved_at DESC);

CREATE INDEX IF NOT EXISTS status_changes_changed_at_idx
  ON public.status_changes (changed_at DESC);

CREATE OR REPLACE FUNCTION public.location_ancestor_ids(p_location_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH RECURSIVE chain AS (
    SELECT l.id, l.parent_id, 1 AS depth
    FROM public.locations AS l
    WHERE l.id = p_location_id
    UNION ALL
    SELECT parent.id, parent.parent_id, chain.depth + 1
    FROM public.locations AS parent
    JOIN chain ON chain.parent_id = parent.id
    WHERE chain.depth < 100
  )
  SELECT COALESCE(array_agg(chain.id), ARRAY[]::uuid[])
  FROM chain;
$$;

COMMENT ON FUNCTION public.location_ancestor_ids(uuid) IS
  'Место и все предки до корня. Пустой массив, если места нет. Фильтр журнала по поддереву.';

CREATE OR REPLACE FUNCTION public.move_equipment_bulk(
  equipment_ids uuid[],
  to_location_id uuid,
  comment text
)
RETURNS SETOF public.equipment
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
  v_ids uuid[];
  v_id uuid;
  v_found integer;
  v_row public.equipment;
BEGIN
  v_role := public.current_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Недостаточно прав для перемещения';
  END IF;

  IF equipment_ids IS NULL OR cardinality(equipment_ids) = 0 THEN
    RAISE EXCEPTION 'Выберите хотя бы одну единицу';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(equipment_ids) AS item
    WHERE item IS NULL
  ) THEN
    RAISE EXCEPTION 'В списке единиц пустой идентификатор';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT item ORDER BY item), ARRAY[]::uuid[])
  INTO v_ids
  FROM unnest(equipment_ids) AS item;

  IF cardinality(v_ids) > 200 THEN
    RAISE EXCEPTION 'За один раз можно изменить не больше 200 единиц';
  END IF;

  SELECT count(*)
  INTO v_found
  FROM public.equipment AS e
  WHERE e.id = ANY (v_ids);

  IF v_found <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Единица не найдена или нет прав на изменение';
  END IF;

  PERFORM 1
  FROM public.equipment AS e
  WHERE e.id = ANY (v_ids)
  ORDER BY e.id
  FOR UPDATE;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT e.*
    INTO v_row
    FROM public.equipment AS e
    WHERE e.id = v_id;

    IF v_row.location_id IS NOT DISTINCT FROM move_equipment_bulk.to_location_id THEN
      RAISE EXCEPTION 'Место не изменилось у %', v_row.code;
    END IF;

    PERFORM public.move_equipment(
      v_id,
      move_equipment_bulk.to_location_id,
      move_equipment_bulk.comment
    );
  END LOOP;

  RETURN QUERY
  SELECT e.*
  FROM public.equipment AS e
  WHERE e.id = ANY (v_ids)
  ORDER BY e.code;
END;
$$;

COMMENT ON FUNCTION public.move_equipment_bulk(uuid[], uuid, text) IS
  'Перемещение нескольких единиц одной транзакцией. Ошибка на любой единице откатывает весь пакет. Разрешено при любом статусе. История пишется по каждой.';

CREATE OR REPLACE FUNCTION public.change_equipment_status_bulk(
  equipment_ids uuid[],
  new_status public.equipment_status,
  comment text
)
RETURNS SETOF public.equipment
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_role public.app_role;
  v_ids uuid[];
  v_id uuid;
  v_found integer;
  v_row public.equipment;
BEGIN
  v_role := public.current_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'editor') THEN
    RAISE EXCEPTION 'Недостаточно прав для смены статуса';
  END IF;

  IF equipment_ids IS NULL OR cardinality(equipment_ids) = 0 THEN
    RAISE EXCEPTION 'Выберите хотя бы одну единицу';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(equipment_ids) AS item
    WHERE item IS NULL
  ) THEN
    RAISE EXCEPTION 'В списке единиц пустой идентификатор';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT item ORDER BY item), ARRAY[]::uuid[])
  INTO v_ids
  FROM unnest(equipment_ids) AS item;

  IF cardinality(v_ids) > 200 THEN
    RAISE EXCEPTION 'За один раз можно изменить не больше 200 единиц';
  END IF;

  SELECT count(*)
  INTO v_found
  FROM public.equipment AS e
  WHERE e.id = ANY (v_ids);

  IF v_found <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Единица не найдена или нет прав на изменение';
  END IF;

  PERFORM 1
  FROM public.equipment AS e
  WHERE e.id = ANY (v_ids)
  ORDER BY e.id
  FOR UPDATE;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT e.*
    INTO v_row
    FROM public.equipment AS e
    WHERE e.id = v_id;

    IF v_row.status IS NOT DISTINCT FROM change_equipment_status_bulk.new_status THEN
      RAISE EXCEPTION 'Статус не изменился у %', v_row.code;
    END IF;

    PERFORM public.change_equipment_status(
      v_id,
      change_equipment_status_bulk.new_status,
      change_equipment_status_bulk.comment
    );
  END LOOP;

  RETURN QUERY
  SELECT e.*
  FROM public.equipment AS e
  WHERE e.id = ANY (v_ids)
  ORDER BY e.code;
END;
$$;

COMMENT ON FUNCTION public.change_equipment_status_bulk(uuid[], public.equipment_status, text) IS
  'Смена статуса нескольких единиц одной транзакцией. Ошибка на любой единице откатывает весь пакет. История пишется по каждой.';

CREATE OR REPLACE VIEW public.journal_events
WITH (security_invoker = true) AS
SELECT
  m.id,
  'movement'::text AS event_kind,
  m.moved_at AS occurred_at,
  m.equipment_id,
  e.code AS equipment_code,
  e.nomenclature_id,
  n.name AS nomenclature_name,
  m.moved_by AS actor_id,
  p.full_name AS actor_name,
  m.comment,
  m.from_location_id,
  m.to_location_id,
  public.location_full_path(m.from_location_id) AS from_path,
  public.location_full_path(m.to_location_id) AS to_path,
  NULL::public.equipment_status AS from_status,
  NULL::public.equipment_status AS to_status,
  COALESCE(public.location_ancestor_ids(m.from_location_id), ARRAY[]::uuid[])
    || COALESCE(public.location_ancestor_ids(m.to_location_id), ARRAY[]::uuid[]) AS location_scope,
  ARRAY[]::public.equipment_status[] AS status_scope
FROM public.movements AS m
JOIN public.equipment AS e ON e.id = m.equipment_id
JOIN public.nomenclature AS n ON n.id = e.nomenclature_id
JOIN public.profiles AS p ON p.id = m.moved_by
UNION ALL
SELECT
  s.id,
  'status_change'::text AS event_kind,
  s.changed_at AS occurred_at,
  s.equipment_id,
  e.code AS equipment_code,
  e.nomenclature_id,
  n.name AS nomenclature_name,
  s.changed_by AS actor_id,
  p.full_name AS actor_name,
  s.comment,
  NULL::uuid AS from_location_id,
  NULL::uuid AS to_location_id,
  NULL::text AS from_path,
  NULL::text AS to_path,
  s.from_status,
  s.to_status,
  ARRAY[]::uuid[] AS location_scope,
  ARRAY_REMOVE(ARRAY[s.from_status, s.to_status], NULL) AS status_scope
FROM public.status_changes AS s
JOIN public.equipment AS e ON e.id = s.equipment_id
JOIN public.nomenclature AS n ON n.id = e.nomenclature_id
JOIN public.profiles AS p ON p.id = s.changed_by;

COMMENT ON VIEW public.journal_events IS
  'Лента перемещений и смен статуса. location_scope — место и предки «откуда» и «куда». status_scope — статусы смены. security_invoker.';

CREATE OR REPLACE VIEW public.equipment_status_counts
WITH (security_invoker = true) AS
SELECT
  statuses.status,
  COALESCE(counts.equipment_count, 0)::bigint AS equipment_count
FROM unnest(enum_range(NULL::public.equipment_status)) AS statuses(status)
LEFT JOIN (
  SELECT e.status, count(*)::bigint AS equipment_count
  FROM public.equipment AS e
  GROUP BY e.status
) AS counts ON counts.status = statuses.status;

COMMENT ON VIEW public.equipment_status_counts IS
  'Число единиц по каждому статусу, включая нули. security_invoker: учитывает RLS.';

REVOKE ALL ON FUNCTION public.location_ancestor_ids(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.move_equipment_bulk(uuid[], uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.change_equipment_status_bulk(uuid[], public.equipment_status, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.location_ancestor_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_equipment_bulk(uuid[], uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_equipment_status_bulk(uuid[], public.equipment_status, text) TO authenticated;

REVOKE ALL ON TABLE public.journal_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.equipment_status_counts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.journal_events TO authenticated;
GRANT SELECT ON public.equipment_status_counts TO authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
