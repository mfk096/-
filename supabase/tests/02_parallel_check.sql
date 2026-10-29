-- После 20 параллельных вставок номера RACE-001 … RACE-020 уникальны и без повторов.

DO $$
DECLARE
  v_count integer;
  v_distinct integer;
  v_last integer;
  v_missing integer;
BEGIN
  SELECT count(*), count(DISTINCT e.code)
  INTO v_count, v_distinct
  FROM public.equipment AS e
  JOIN public.nomenclature AS n ON n.id = e.nomenclature_id
  WHERE n.code_prefix = 'RACE';

  IF v_count <> 20 OR v_distinct <> 20 THEN
    RAISE EXCEPTION 'FAIL: параллельно count=% distinct=%', v_count, v_distinct;
  END IF;

  SELECT c.last_number
  INTO v_last
  FROM public.code_counters AS c
  WHERE c.prefix = 'RACE';

  IF v_last <> 20 THEN
    RAISE EXCEPTION 'FAIL: счётчик RACE = %', v_last;
  END IF;

  SELECT count(*)
  INTO v_missing
  FROM generate_series(1, 20) AS g
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.equipment AS e
    WHERE e.code = 'RACE-' || lpad(g::text, 3, '0')
  );

  IF v_missing <> 0 THEN
    RAISE EXCEPTION 'FAIL: не хватает % кодов RACE', v_missing;
  END IF;

  RAISE NOTICE 'ok: parallel';
END;
$$;
