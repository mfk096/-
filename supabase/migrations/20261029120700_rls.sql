-- Роль authenticated на Supabase уже может вызывать auth.uid(). Повтор гранта безвреден
-- и нужен, если права на схему auth ещё не выданы.
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

-- RLS: anon не видит ничего. Чтение — активным пользователям.
-- Единицы и журналы пишут editor и admin. Справочники и профили — admin.
-- current_role() — security definer, чтобы политика profiles не зацикливалась.

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.role
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
    AND p.is_active;
$$;

COMMENT ON FUNCTION public.current_role() IS
  'Роль активного пользователя сессии. NULL, если нет профиля или is_active = false. Вызывать как public.current_role().';

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nomenclature_before_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.nomenclature_after_insert_counter() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.code_counters_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.equipment_before_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forbid_equipment_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.forbid_history_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.movements_before_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.status_changes_before_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.equipment_write_history() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_equipment(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.change_equipment_status(uuid, public.equipment_status, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verifications_before_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verifications_after_write() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.locations_prevent_cycle() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.location_full_path(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.effective_responsible_employee_id(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_self_role_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_role() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.location_full_path(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.effective_responsible_employee_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_equipment(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_equipment_status(uuid, public.equipment_status, text) TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nomenclature ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.status_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.employees FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.locations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nomenclature FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.code_counters FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.equipment FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.movements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.status_changes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.verifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.locations_with_path FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.nomenclature_with_counts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.equipment_list FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.movement_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.status_change_history FROM PUBLIC, anon, authenticated;

GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nomenclature TO authenticated;
GRANT SELECT ON public.code_counters TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.equipment TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.movements TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.status_changes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.verifications TO authenticated;
GRANT SELECT ON public.locations_with_path TO authenticated;
GRANT SELECT ON public.nomenclature_with_counts TO authenticated;
GRANT SELECT ON public.equipment_list TO authenticated;
GRANT SELECT ON public.movement_history TO authenticated;
GRANT SELECT ON public.status_change_history TO authenticated;

CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (public.current_role() IS NOT NULL);

CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.current_role() = 'admin')
  WITH CHECK (public.current_role() = 'admin');

CREATE POLICY employees_select ON public.employees
  FOR SELECT TO authenticated
  USING (public.current_role() IS NOT NULL);

CREATE POLICY employees_insert ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK (public.current_role() = 'admin');

CREATE POLICY employees_update ON public.employees
  FOR UPDATE TO authenticated
  USING (public.current_role() = 'admin')
  WITH CHECK (public.current_role() = 'admin');

CREATE POLICY employees_delete ON public.employees
  FOR DELETE TO authenticated
  USING (public.current_role() = 'admin');

CREATE POLICY locations_select ON public.locations
  FOR SELECT TO authenticated
  USING (public.current_role() IS NOT NULL);

CREATE POLICY locations_insert ON public.locations
  FOR INSERT TO authenticated
  WITH CHECK (public.current_role() = 'admin');

CREATE POLICY locations_update ON public.locations
  FOR UPDATE TO authenticated
  USING (public.current_role() = 'admin')
  WITH CHECK (public.current_role() = 'admin');

CREATE POLICY locations_delete ON public.locations
  FOR DELETE TO authenticated
  USING (public.current_role() = 'admin');

CREATE POLICY nomenclature_select ON public.nomenclature
  FOR SELECT TO authenticated
  USING (public.current_role() IS NOT NULL);

CREATE POLICY nomenclature_insert ON public.nomenclature
  FOR INSERT TO authenticated
  WITH CHECK (public.current_role() = 'admin');

CREATE POLICY nomenclature_update ON public.nomenclature
  FOR UPDATE TO authenticated
  USING (public.current_role() = 'admin')
  WITH CHECK (public.current_role() = 'admin');

CREATE POLICY nomenclature_delete ON public.nomenclature
  FOR DELETE TO authenticated
  USING (public.current_role() = 'admin');

CREATE POLICY code_counters_select ON public.code_counters
  FOR SELECT TO authenticated
  USING (public.current_role() IS NOT NULL);

CREATE POLICY equipment_select ON public.equipment
  FOR SELECT TO authenticated
  USING (public.current_role() IS NOT NULL);

CREATE POLICY equipment_insert ON public.equipment
  FOR INSERT TO authenticated
  WITH CHECK (public.current_role() IN ('admin', 'editor'));

CREATE POLICY equipment_update ON public.equipment
  FOR UPDATE TO authenticated
  USING (public.current_role() IN ('admin', 'editor'))
  WITH CHECK (public.current_role() IN ('admin', 'editor'));

CREATE POLICY movements_select ON public.movements
  FOR SELECT TO authenticated
  USING (public.current_role() IS NOT NULL);

CREATE POLICY movements_insert ON public.movements
  FOR INSERT TO authenticated
  WITH CHECK (public.current_role() IN ('admin', 'editor'));

CREATE POLICY movements_update ON public.movements
  FOR UPDATE TO authenticated
  USING (public.current_role() IN ('admin', 'editor'))
  WITH CHECK (public.current_role() IN ('admin', 'editor'));

CREATE POLICY status_changes_select ON public.status_changes
  FOR SELECT TO authenticated
  USING (public.current_role() IS NOT NULL);

CREATE POLICY status_changes_insert ON public.status_changes
  FOR INSERT TO authenticated
  WITH CHECK (public.current_role() IN ('admin', 'editor'));

CREATE POLICY status_changes_update ON public.status_changes
  FOR UPDATE TO authenticated
  USING (public.current_role() IN ('admin', 'editor'))
  WITH CHECK (public.current_role() IN ('admin', 'editor'));

CREATE POLICY verifications_select ON public.verifications
  FOR SELECT TO authenticated
  USING (public.current_role() IS NOT NULL);

CREATE POLICY verifications_insert ON public.verifications
  FOR INSERT TO authenticated
  WITH CHECK (public.current_role() IN ('admin', 'editor'));

CREATE POLICY verifications_update ON public.verifications
  FOR UPDATE TO authenticated
  USING (public.current_role() IN ('admin', 'editor'))
  WITH CHECK (public.current_role() IN ('admin', 'editor'));
