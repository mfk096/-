-- Этап 6: приватный бакет свидетельств поверки и политики storage.objects.
-- Идемпотентна. Читать могут активные пользователи, писать — editor и admin.
-- На голом Postgres схему storage создаёт тестовая заглушка. На боевой Supabase она уже есть.

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION
      'Нет storage.buckets или storage.objects. На Supabase они есть. Для голого Postgres сначала примените supabase/tests/00_auth_stub.sql';
  END IF;
END;
$$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('verification-certificates', 'verification-certificates', false)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
      AND column_name = 'file_size_limit'
  ) THEN
    UPDATE storage.buckets
    SET file_size_limit = 10485760
    WHERE id = 'verification-certificates';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'storage'
      AND table_name = 'buckets'
      AND column_name = 'allowed_mime_types'
  ) THEN
    UPDATE storage.buckets
    SET allowed_mime_types = ARRAY[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/heic',
      'image/heif'
    ]
    WHERE id = 'verification-certificates';
  END IF;
END;
$$;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS verification_certificates_select ON storage.objects;
CREATE POLICY verification_certificates_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'verification-certificates'
    AND public.current_role() IS NOT NULL
  );

DROP POLICY IF EXISTS verification_certificates_insert ON storage.objects;
CREATE POLICY verification_certificates_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'verification-certificates'
    AND public.current_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS verification_certificates_update ON storage.objects;
CREATE POLICY verification_certificates_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'verification-certificates'
    AND public.current_role() IN ('admin', 'editor')
  )
  WITH CHECK (
    bucket_id = 'verification-certificates'
    AND public.current_role() IN ('admin', 'editor')
  );

DROP POLICY IF EXISTS verification_certificates_delete ON storage.objects;
CREATE POLICY verification_certificates_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'verification-certificates'
    AND public.current_role() IN ('admin', 'editor')
  );
