CREATE TABLE IF NOT EXISTS public.booking_pages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug          TEXT UNIQUE NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  business_name TEXT,
  industry      TEXT,
  logo_url      TEXT,
  color_primary TEXT DEFAULT '#0F3460',
  timezone      TEXT DEFAULT 'America/Los_Angeles',
  is_active     BOOLEAN DEFAULT true,
  settings      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_page_id UUID NOT NULL REFERENCES public.booking_pages(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  duration_mins   INTEGER NOT NULL DEFAULT 60,
  price           DECIMAL(10,2),
  currency        TEXT DEFAULT 'USD',
  max_per_day     INTEGER DEFAULT 10,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bookings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_page_id UUID NOT NULL REFERENCES public.booking_pages(id) ON DELETE CASCADE,
  service_id      UUID REFERENCES public.booking_services(id),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_name     TEXT NOT NULL,
  client_email    TEXT NOT NULL,
  client_phone    TEXT,
  notes           TEXT,
  date            DATE NOT NULL,
  time_slot       TEXT NOT NULL,
  duration_mins   INTEGER DEFAULT 60,
  status          TEXT DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled','completed','no_show')),
  price           DECIMAL(10,2),
  reminder_sent   BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.booking_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_booking_pages" ON public.booking_pages FOR ALL USING (
  org_id IN (SELECT org_id FROM public.organization_members WHERE user_id = auth.uid())
);

CREATE POLICY "org_members_booking_services" ON public.booking_services FOR ALL USING (
  booking_page_id IN (SELECT id FROM public.booking_pages WHERE org_id IN (
    SELECT org_id FROM public.organization_members WHERE user_id = auth.uid()
  ))
);

CREATE POLICY "org_members_bookings" ON public.bookings FOR ALL USING (
  org_id IN (SELECT org_id FROM public.organization_members WHERE user_id = auth.uid())
);

CREATE POLICY "public_bookings_insert" ON public.bookings FOR INSERT WITH CHECK (true);
