-- Таблицы учёта. Схема auth уже есть на Supabase; для голого Postgres её создаёт тестовая заглушка.

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'viewer',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_full_name_chk CHECK (char_length(btrim(full_name)) > 0)
);

COMMENT ON TABLE public.profiles IS 'Профиль пользователя приложения. Одна строка на auth.users.';
COMMENT ON COLUMN public.profiles.role IS 'Назначает администратор. Сам себе роль пользователь не меняет.';
COMMENT ON COLUMN public.profiles.is_active IS 'false — нет доступа к данным, даже если сессия ещё жива.';

CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  position text,
  phone text,
  profile_id uuid UNIQUE REFERENCES public.profiles (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employees_full_name_chk CHECK (char_length(btrim(full_name)) > 0)
);

COMMENT ON TABLE public.employees IS 'Сотрудники, которых можно назначить ответственными. Учётная запись не обязательна.';

CREATE TABLE public.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES public.locations (id) ON DELETE RESTRICT,
  name text NOT NULL,
  kind text NOT NULL,
  responsible_employee_id uuid REFERENCES public.employees (id) ON DELETE RESTRICT,
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locations_name_chk CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT locations_kind_chk CHECK (char_length(btrim(kind)) > 0),
  CONSTRAINT locations_not_self_parent_chk CHECK (parent_id IS DISTINCT FROM id)
);

COMMENT ON TABLE public.locations IS 'Дерево мест произвольной глубины. В строке только свой ответственный.';
COMMENT ON COLUMN public.locations.kind IS 'Свободная подпись уровня: завод, цех, участок и дальше. Закрытого списка нет.';
COMMENT ON COLUMN public.locations.is_archived IS 'Архивное место не назначают новым единицам, но оно остаётся в истории.';

CREATE TABLE public.nomenclature (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_prefix text NOT NULL UNIQUE,
  name text NOT NULL,
  manufacturer text,
  model text,
  category text,
  requires_verification boolean NOT NULL DEFAULT false,
  verification_interval_months integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT nomenclature_prefix_format_chk CHECK (code_prefix ~ '^[A-Z0-9]{2,8}$'),
  CONSTRAINT nomenclature_name_chk CHECK (char_length(btrim(name)) > 0),
  CONSTRAINT nomenclature_verification_chk CHECK (
    (
      requires_verification
      AND verification_interval_months IS NOT NULL
      AND verification_interval_months > 0
    )
    OR (
      NOT requires_verification
      AND verification_interval_months IS NULL
    )
  )
);

COMMENT ON TABLE public.nomenclature IS 'Тип или модель оборудования. Префикс кода уникален и не отдаётся другой позиции.';
COMMENT ON COLUMN public.nomenclature.code_prefix IS '2–8 символов A–Z и цифр. После появления единиц не меняется.';

CREATE TABLE public.code_counters (
  prefix text PRIMARY KEY REFERENCES public.nomenclature (code_prefix) ON UPDATE CASCADE ON DELETE CASCADE,
  last_number integer NOT NULL DEFAULT 0,
  CONSTRAINT code_counters_last_number_chk CHECK (last_number >= 0)
);

COMMENT ON TABLE public.code_counters IS 'Последний выданный номер префикса. Счётчик только растёт, номера не переиспользуются.';

CREATE TABLE public.equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nomenclature_id uuid NOT NULL REFERENCES public.nomenclature (id) ON DELETE RESTRICT,
  code text NOT NULL UNIQUE,
  serial_number text,
  inventory_number text,
  status public.equipment_status NOT NULL DEFAULT 'in_work',
  location_id uuid REFERENCES public.locations (id) ON DELETE RESTRICT,
  last_verification_date date,
  next_verification_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT equipment_code_format_chk CHECK (code ~ '^[A-Z0-9]{2,8}-[0-9]+$')
);

COMMENT ON TABLE public.equipment IS 'Конкретная единица. Строка не удаляется: выбытие — статус written_off.';
COMMENT ON COLUMN public.equipment.code IS 'Выдаёт база, вид ПРЕФИКС-NNN. Значение клиента игнорируется.';

CREATE TABLE public.movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.equipment (id) ON DELETE RESTRICT,
  from_location_id uuid REFERENCES public.locations (id) ON DELETE RESTRICT,
  to_location_id uuid REFERENCES public.locations (id) ON DELETE RESTRICT,
  moved_at timestamptz NOT NULL DEFAULT now(),
  moved_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  comment text
);

COMMENT ON TABLE public.movements IS 'История перемещений. Разрешена при любом статусе единицы.';

CREATE TABLE public.status_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.equipment (id) ON DELETE RESTRICT,
  from_status public.equipment_status,
  to_status public.equipment_status NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid NOT NULL REFERENCES public.profiles (id) ON DELETE RESTRICT,
  comment text
);

COMMENT ON TABLE public.status_changes IS 'История смен статуса. Первая запись создаётся вместе с единицей.';

CREATE TABLE public.verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL REFERENCES public.equipment (id) ON DELETE RESTRICT,
  verified_at timestamptz NOT NULL,
  result public.verification_result NOT NULL,
  next_due_at date,
  certificate_number text,
  file_path text,
  comment text
);

COMMENT ON TABLE public.verifications IS 'Журнал поверок. Только у единиц, чья номенклатура требует поверки.';
COMMENT ON COLUMN public.verifications.file_path IS 'Путь свидетельства в Storage. Бакет появится вместе с разделом поверок.';

CREATE INDEX employees_profile_id_idx ON public.employees (profile_id);
CREATE INDEX locations_parent_id_idx ON public.locations (parent_id);
CREATE INDEX locations_responsible_employee_id_idx ON public.locations (responsible_employee_id);
CREATE INDEX equipment_nomenclature_id_idx ON public.equipment (nomenclature_id);
CREATE INDEX equipment_location_id_idx ON public.equipment (location_id);
CREATE INDEX equipment_status_idx ON public.equipment (status);
CREATE INDEX equipment_serial_number_idx ON public.equipment (serial_number);
CREATE INDEX movements_equipment_id_idx ON public.movements (equipment_id, moved_at DESC);
CREATE INDEX movements_from_location_id_idx ON public.movements (from_location_id);
CREATE INDEX movements_to_location_id_idx ON public.movements (to_location_id);
CREATE INDEX movements_moved_by_idx ON public.movements (moved_by);
CREATE INDEX status_changes_equipment_id_idx ON public.status_changes (equipment_id, changed_at DESC);
CREATE INDEX status_changes_changed_by_idx ON public.status_changes (changed_by);
CREATE INDEX verifications_equipment_id_idx ON public.verifications (equipment_id, verified_at DESC);

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER employees_set_updated_at
  BEFORE UPDATE ON public.employees
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER locations_set_updated_at
  BEFORE UPDATE ON public.locations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER nomenclature_set_updated_at
  BEFORE UPDATE ON public.nomenclature
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER equipment_set_updated_at
  BEFORE UPDATE ON public.equipment
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
