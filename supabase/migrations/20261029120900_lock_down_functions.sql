-- На Supabase CREATE FUNCTION в public раздаёт EXECUTE ролям anon и authenticated
-- отдельно от PUBLIC. REVOKE только у PUBLIC их не снимает, и security definer
-- функции видны в /rest/v1/rpc (lint 0028/0029).
-- Триггеру EXECUTE вызывающего пользователя не нужен.
-- Миграция идемпотентна: повторный REVOKE/GRANT ничего не меняет.

REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nomenclature_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.nomenclature_after_insert_counter() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.code_counters_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.equipment_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.forbid_equipment_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.forbid_history_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.movements_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.status_changes_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.equipment_write_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verifications_before_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verifications_after_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.locations_prevent_cycle() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_self_role_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.backfill_profiles() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.current_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_role() TO authenticated;

REVOKE ALL ON FUNCTION public.move_equipment(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.change_equipment_status(uuid, public.equipment_status, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.move_equipment(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.change_equipment_status(uuid, public.equipment_status, text) TO authenticated;

-- Глобальный REVOKE обязателен: Postgres сливает права схемы с глобальными,
-- и без него новая функция всё равно получает EXECUTE для PUBLIC.
-- Уже выданные GRANT на move_equipment и change_equipment_status это не трогает.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
