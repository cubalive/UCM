-- ============================================================
-- United Care Mobility — Supabase Migration (Idempotent)
-- ============================================================

-- PHASE 1: TABLES

-- 1a) cities
CREATE TABLE IF NOT EXISTS public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  state text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1b) profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE,
  role text NOT NULL DEFAULT 'driver',
  city_id uuid NULL REFERENCES public.cities(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 1c) Seed Las Vegas city
INSERT INTO public.cities (slug, name, state)
VALUES ('las-vegas', 'Las Vegas', 'NV')
ON CONFLICT (slug) DO NOTHING;

-- 1d) Ensure admin profile exists as super_admin
INSERT INTO public.profiles (id, email, role)
SELECT id, email, 'super_admin'
FROM auth.users
WHERE email = 'admin@unitedcaremobility.com'
ON CONFLICT (id) DO UPDATE SET role = 'super_admin';

-- ============================================================
-- PHASE 2: HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_uid()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(public.current_role() = 'super_admin', false);
$$;

CREATE OR REPLACE FUNCTION public.is_dispatch()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT COALESCE(public.current_role() = 'dispatch', false);
$$;

CREATE OR REPLACE FUNCTION public.current_city_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT city_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ============================================================
-- PHASE 3: RLS DEFAULT-DENY + POLICIES
-- ============================================================

-- Enable RLS
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ---------- cities policies ----------
DROP POLICY IF EXISTS "cities_select_authenticated" ON public.cities;
CREATE POLICY "cities_select_authenticated" ON public.cities
  FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "cities_insert_super_admin" ON public.cities;
CREATE POLICY "cities_insert_super_admin" ON public.cities
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "cities_update_super_admin" ON public.cities;
CREATE POLICY "cities_update_super_admin" ON public.cities
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "cities_delete_super_admin" ON public.cities;
CREATE POLICY "cities_delete_super_admin" ON public.cities
  FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- ---------- profiles policies ----------
DROP POLICY IF EXISTS "profiles_select_own_or_super" ON public.profiles;
CREATE POLICY "profiles_select_own_or_super" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid() OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_super_admin" ON public.profiles;
CREATE POLICY "profiles_update_super_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "profiles_insert_super_admin" ON public.profiles;
CREATE POLICY "profiles_insert_super_admin" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "profiles_delete_super_admin" ON public.profiles;
CREATE POLICY "profiles_delete_super_admin" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.is_super_admin());
