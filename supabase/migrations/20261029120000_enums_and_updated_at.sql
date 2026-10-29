-- Перечисления и общий триггер updated_at.
-- Коды статусов — из docs/decisions.md, русские подписи живут во фронтенде.

CREATE TYPE public.app_role AS ENUM ('admin', 'editor', 'viewer');

CREATE TYPE public.equipment_status AS ENUM (
  'in_work',
  'on_verification',
  'in_repair',
  'written_off',
  'reserve'
);

CREATE TYPE public.verification_result AS ENUM ('passed', 'failed');

COMMENT ON TYPE public.app_role IS 'Роли приложения: admin, editor, viewer.';
COMMENT ON TYPE public.equipment_status IS
  'Статусы единицы: in_work, on_verification, in_repair, written_off, reserve.';
COMMENT ON TYPE public.verification_result IS 'Результат поверки: passed — годен, failed — не годен.';

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
