-- Пример завода для локальной разработки (supabase db reset).
-- Не входит в миграции и на боевой проект не применяется.
--
-- Учётные записи только для локального Auth, пароль у всех один: demo-local-password
--   demo.admin@plant.local   — admin
--   demo.editor@plant.local  — editor
--   demo.viewer@plant.local  — viewer

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION pg_temp.seed_insert(p_schema text, p_table text, p_known jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rec record;
  v_cols text := '';
  v_vals text := '';
  v_expr text;
BEGIN
  FOR rec IN
    SELECT
      column_name,
      data_type,
      is_nullable,
      column_default,
      is_generated,
      is_identity
    FROM information_schema.columns
    WHERE table_schema = p_schema
      AND table_name = p_table
    ORDER BY ordinal_position
  LOOP
    IF rec.is_generated = 'ALWAYS' OR rec.is_identity = 'YES' THEN
      CONTINUE;
    END IF;

    v_expr := p_known ->> rec.column_name;
    IF v_expr IS NULL THEN
      IF rec.is_nullable = 'YES' OR rec.column_default IS NOT NULL THEN
        CONTINUE;
      END IF;
      IF rec.data_type IN ('text', 'character varying') THEN
        v_expr := quote_literal('');
      ELSIF rec.data_type = 'boolean' THEN
        v_expr := 'false';
      ELSIF rec.data_type = 'uuid' THEN
        v_expr := 'gen_random_uuid()';
      ELSIF rec.data_type IN ('json', 'jsonb') THEN
        v_expr := '''{}''::jsonb';
      ELSIF rec.data_type IN ('timestamp with time zone', 'timestamp without time zone') THEN
        v_expr := 'now()';
      ELSIF rec.data_type IN ('integer', 'smallint', 'bigint') THEN
        v_expr := '0';
      ELSE
        RAISE EXCEPTION 'seed: нет значения для %.%', p_table, rec.column_name;
      END IF;
    END IF;

    v_cols := v_cols || quote_ident(rec.column_name) || ',';
    v_vals := v_vals || v_expr || ',';
  END LOOP;

  EXECUTE format(
    'INSERT INTO %I.%I (%s) VALUES (%s)',
    p_schema,
    p_table,
    left(v_cols, -1),
    left(v_vals, -1)
  );
END;
$$;

DO $$
DECLARE
  v_admin uuid := 'a1111111-1111-4111-8111-111111111111';
  v_editor uuid := 'a2222222-2222-4222-8222-222222222222';
  v_viewer uuid := 'a3333333-3333-4333-8333-333333333333';
  v_ivan uuid := 'b1111111-1111-4111-8111-111111111111';
  v_maria uuid := 'b2222222-2222-4222-8222-222222222222';
  v_plant uuid := 'c1111111-1111-4111-8111-111111111111';
  v_shop uuid := 'c2222222-2222-4222-8222-222222222222';
  v_print uuid := 'c3333333-3333-4333-8333-333333333333';
  v_metro uuid := 'c4444444-4444-4444-8444-444444444444';
  v_store uuid := 'c5555555-5555-4555-8555-555555555555';
  v_old uuid := 'c6666666-6666-4666-8666-666666666666';
  v_kyoc uuid := 'd1111111-1111-4111-8111-111111111111';
  v_scale uuid := 'd2222222-2222-4222-8222-222222222222';
  v_dell uuid := 'd3333333-3333-4333-8333-333333333333';
  v_crypto text;
  v_pass text;
  v_user record;
BEGIN
  SELECT n.nspname
  INTO v_crypto
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE p.proname = 'crypt'
  ORDER BY CASE n.nspname WHEN 'extensions' THEN 0 WHEN 'public' THEN 1 ELSE 2 END
  LIMIT 1;

  IF v_crypto IS NULL THEN
    v_pass := quote_literal('demo-local-password');
  ELSE
    v_pass := format(
      '%I.crypt(%L, %I.gen_salt(%L))',
      v_crypto,
      'demo-local-password',
      v_crypto,
      'bf'
    );
  END IF;

  FOR v_user IN
    SELECT *
    FROM (
      VALUES
        (v_admin, 'demo.admin@plant.local', 'Демо администратор'),
        (v_editor, 'demo.editor@plant.local', 'Демо редактор'),
        (v_viewer, 'demo.viewer@plant.local', 'Демо просмотр')
    ) AS users (id, email, full_name)
  LOOP
    IF EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = v_user.id OR u.email = v_user.email) THEN
      CONTINUE;
    END IF;

    PERFORM pg_temp.seed_insert(
      'auth',
      'users',
      jsonb_build_object(
        'id', quote_literal(v_user.id) || '::uuid',
        'instance_id', quote_literal('00000000-0000-0000-0000-000000000000') || '::uuid',
        'aud', quote_literal('authenticated'),
        'role', quote_literal('authenticated'),
        'email', quote_literal(v_user.email),
        'encrypted_password', v_pass,
        'email_confirmed_at', 'now()',
        'raw_app_meta_data', quote_literal('{"provider":"email","providers":["email"]}') || '::jsonb',
        'raw_user_meta_data', quote_literal(jsonb_build_object('full_name', v_user.full_name)::text) || '::jsonb',
        'created_at', 'now()',
        'updated_at', 'now()',
        'last_sign_in_at', 'now()',
        'confirmation_token', quote_literal(''),
        'recovery_token', quote_literal(''),
        'email_change', quote_literal(''),
        'email_change_token_new', quote_literal(''),
        'email_change_token_current', quote_literal(''),
        'email_change_confirm_status', '0',
        'is_sso_user', 'false',
        'is_anonymous', 'false'
      )
    );

    IF to_regclass('auth.identities') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM auth.identities AS i WHERE i.user_id = v_user.id) THEN
      PERFORM pg_temp.seed_insert(
        'auth',
        'identities',
        jsonb_build_object(
          'id', quote_literal(v_user.id) || '::uuid',
          'user_id', quote_literal(v_user.id) || '::uuid',
          'identity_data',
            quote_literal(jsonb_build_object('sub', v_user.id, 'email', v_user.email)::text) || '::jsonb',
          'provider', quote_literal('email'),
          'provider_id', quote_literal(v_user.id::text),
          'last_sign_in_at', 'now()',
          'created_at', 'now()',
          'updated_at', 'now()',
          'email', quote_literal(v_user.email)
        )
      );
    END IF;
  END LOOP;

  UPDATE public.profiles
  SET role = 'admin', full_name = 'Демо администратор'
  WHERE id = v_admin;

  UPDATE public.profiles
  SET role = 'editor', full_name = 'Демо редактор'
  WHERE id = v_editor;

  UPDATE public.profiles
  SET role = 'viewer', full_name = 'Демо просмотр'
  WHERE id = v_viewer;

  INSERT INTO public.employees (id, full_name, position, phone)
  VALUES
    (v_ivan, 'Иван Петров', 'Начальник производства', '+7 900 000-00-01'),
    (v_maria, 'Мария Соколова', 'Метролог', '+7 900 000-00-02')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.locations (id, parent_id, name, kind, responsible_employee_id, is_archived)
  VALUES
    (v_plant, NULL, 'Завод «Северный»', 'завод', v_ivan, false),
    (v_shop, v_plant, 'Цех механообработки', 'цех', NULL, false),
    (v_print, v_shop, 'Участок печати', 'участок', NULL, false),
    (v_metro, v_shop, 'Участок метрологии', 'участок', v_maria, false),
    (v_store, v_plant, 'Склад ИТ', 'помещение', NULL, false),
    (v_old, v_plant, 'Старый склад', 'помещение', NULL, true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.nomenclature (
    id,
    code_prefix,
    name,
    manufacturer,
    model,
    category,
    requires_verification,
    verification_interval_months,
    notes
  )
  VALUES
    (
      v_kyoc,
      'KYOC',
      'Принтер Kyocera ECOSYS',
      'Kyocera',
      'ECOSYS M2040dn',
      'Принтеры',
      false,
      NULL,
      'Префикс кода KYOC'
    ),
    (
      v_scale,
      'SCALE',
      'Весы лабораторные',
      'AND',
      'GF-300',
      'Весы',
      true,
      12,
      'Поверка раз в год'
    ),
    (
      v_dell,
      'DELL',
      'Монитор Dell',
      'Dell',
      'P2422H',
      'Компьютеры',
      false,
      NULL,
      NULL
    )
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claim.sub', v_admin::text, false);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text,
    false
  );
  PERFORM set_config('request.jwt.claim.role', 'authenticated', false);

  IF NOT EXISTS (SELECT 1 FROM public.equipment WHERE nomenclature_id = v_kyoc) THEN
    INSERT INTO public.equipment (nomenclature_id, serial_number, inventory_number, status, location_id, notes)
    VALUES
      (v_kyoc, 'SN-KYOC-10001', 'ИНВ-01420', 'in_work', v_print, 'Стоит у мастера участка'),
      (v_kyoc, 'SN-KYOC-10002', 'ИНВ-01421', 'reserve', v_store, 'Запасной, на складе ИТ');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.equipment WHERE nomenclature_id = v_scale) THEN
    INSERT INTO public.equipment (nomenclature_id, serial_number, inventory_number, status, location_id)
    VALUES (v_scale, 'SN-SCALE-20001', 'ИНВ-03011', 'in_work', v_metro);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.equipment WHERE nomenclature_id = v_dell) THEN
    INSERT INTO public.equipment (nomenclature_id, serial_number, status, location_id, notes)
    VALUES (v_dell, 'SN-DELL-30001', 'in_repair', v_shop, 'Нет подсветки, ждёт запчасть');
  END IF;

  INSERT INTO public.verifications (
    equipment_id,
    verified_at,
    result,
    next_due_at,
    certificate_number,
    comment
  )
  SELECT
    e.id,
    timestamptz '2026-03-15 09:00:00+00',
    'passed',
    date '2027-03-15',
    'СП-2026-014',
    'Первичная поверка при вводе'
  FROM public.equipment AS e
  WHERE e.nomenclature_id = v_scale
    AND NOT EXISTS (
      SELECT 1
      FROM public.verifications AS v
      WHERE v.equipment_id = e.id
    );
END;
$$;
