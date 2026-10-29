-- Профили для пользователей, которые уже были в auth.users до триггера.
-- Если среди них есть kb09062001@gmail.com, ему назначается admin.

CREATE OR REPLACE FUNCTION public.backfill_profiles()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  SELECT
    u.id,
    COALESCE(
      NULLIF(btrim(COALESCE(u.raw_user_meta_data, '{}'::jsonb)->>'full_name'), ''),
      NULLIF(btrim(COALESCE(u.raw_user_meta_data, '{}'::jsonb)->>'name'), ''),
      NULLIF(split_part(COALESCE(u.email, ''), '@', 1), ''),
      'Пользователь'
    ),
    'viewer'::public.app_role
  FROM auth.users AS u
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.id = u.id
  );

  UPDATE public.profiles AS p
  SET role = 'admin'
  FROM auth.users AS u
  WHERE u.id = p.id
    AND lower(COALESCE(u.email, '')) = lower('kb09062001@gmail.com')
    AND p.role IS DISTINCT FROM 'admin';
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_profiles() FROM PUBLIC;

SELECT public.backfill_profiles();
