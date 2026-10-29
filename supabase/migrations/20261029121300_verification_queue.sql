-- Этап 6: очередь поверок и сводка для главной.
-- Идемпотентна. Новая функция не security definer.
-- anon и PUBLIC её не исполняют: на Supabase EXECUTE для anon выдаётся напрямую.

CREATE INDEX IF NOT EXISTS equipment_next_verification_idx
  ON public.equipment (next_verification_date);

COMMENT ON COLUMN public.verifications.file_path IS
  'Путь объекта в приватном бакете verification-certificates. Читают активные пользователи, пишут editor и admin.';

CREATE OR REPLACE VIEW public.equipment_verification_queue
WITH (security_invoker = true) AS
SELECT
  e.id,
  e.code,
  e.status,
  e.serial_number,
  e.inventory_number,
  e.location_id,
  e.nomenclature_id,
  e.last_verification_date,
  e.next_verification_date,
  n.name AS nomenclature_name,
  n.code_prefix,
  n.verification_interval_months,
  loc.full_path AS location_path
FROM public.equipment AS e
JOIN public.nomenclature AS n ON n.id = e.nomenclature_id
LEFT JOIN public.locations_with_path AS loc ON loc.id = e.location_id
WHERE n.requires_verification;

COMMENT ON VIEW public.equipment_verification_queue IS
  'Единицы, у которых номенклатура требует поверки, включая списанные. security_invoker: учитывает RLS. Группу «скоро» считает клиент по порогу дней.';

CREATE OR REPLACE VIEW public.verification_journal
WITH (security_invoker = true) AS
SELECT
  v.id,
  v.equipment_id,
  v.verified_at,
  v.result,
  v.next_due_at,
  v.certificate_number,
  v.file_path,
  v.comment,
  e.code AS equipment_code,
  e.status,
  e.nomenclature_id,
  e.location_id,
  n.name AS nomenclature_name,
  n.code_prefix,
  loc.full_path AS location_path
FROM public.verifications AS v
JOIN public.equipment AS e ON e.id = v.equipment_id
JOIN public.nomenclature AS n ON n.id = e.nomenclature_id
LEFT JOIN public.locations_with_path AS loc ON loc.id = e.location_id;

COMMENT ON VIEW public.verification_journal IS
  'Журнал поверок с кодом единицы и путём места. security_invoker.';

CREATE OR REPLACE FUNCTION public.verification_summary(p_soon_days integer DEFAULT 30)
RETURNS TABLE (
  overdue integer,
  soon integer,
  ok integer,
  no_data integer
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_soon_days IS NULL OR p_soon_days < 0 OR p_soon_days > 3650 THEN
    RAISE EXCEPTION 'Порог «скоро поверка» — от 0 до 3650 дней';
  END IF;

  RETURN QUERY
  SELECT
    count(*) FILTER (
      WHERE e.next_verification_date < CURRENT_DATE
    )::integer,
    count(*) FILTER (
      WHERE e.next_verification_date >= CURRENT_DATE
        AND e.next_verification_date <= CURRENT_DATE + p_soon_days
    )::integer,
    count(*) FILTER (
      WHERE e.next_verification_date > CURRENT_DATE + p_soon_days
    )::integer,
    count(*) FILTER (
      WHERE e.next_verification_date IS NULL
    )::integer
  FROM public.equipment AS e
  JOIN public.nomenclature AS n ON n.id = e.nomenclature_id
  WHERE n.requires_verification
    AND e.status <> 'written_off';
END;
$$;

COMMENT ON FUNCTION public.verification_summary(integer) IS
  'Счётчики графика поверок без списанных. Просрочена — дата раньше сегодня. Скоро — от сегодня до сегодня плюс порог включительно. Нет данных — следующая дата пустая. Не security definer, учитывает RLS.';

REVOKE ALL ON FUNCTION public.verification_summary(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verification_summary(integer) TO authenticated;

REVOKE ALL ON TABLE public.equipment_verification_queue FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.verification_journal FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.equipment_verification_queue TO authenticated;
GRANT SELECT ON public.verification_journal TO authenticated;
