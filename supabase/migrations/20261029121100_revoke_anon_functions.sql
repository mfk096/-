-- На Supabase новая функция в public получает EXECUTE для anon напрямую,
-- не через PUBLIC. REVOKE FROM PUBLIC это право не снимает.
-- Снимаем EXECUTE у anon со всех функций public, кроме объектов расширений.
-- Права authenticated не меняются. Повторный REVOKE безвреден.

DO $$
DECLARE
  v_name text;
  v_args text;
  v_kind "char";
  v_sql text;
BEGIN
  FOR v_name, v_args, v_kind IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid), p.prokind
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend AS d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
  LOOP
    v_sql := format(
      'REVOKE EXECUTE ON %s public.%I(%s) FROM anon',
      CASE WHEN v_kind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
      v_name,
      v_args
    );
    EXECUTE v_sql;
  END LOOP;
END;
$$;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
