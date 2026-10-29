-- Applied directly to the live project on 2026-10-16; copied here verbatim
-- from supabase_migrations.schema_migrations so the repo matches the database.

-- ============================================================
-- SENTINEL: Public health surveillance system tables
-- All scoped to sentinel_organizations (separate from hospital orgs)
-- ============================================================

CREATE TABLE public.sentinel_organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL
    CHECK (type IN ('NGO', 'Government', 'Ministry', 'International', 'Research', 'Academic')),
  state TEXT,
  country TEXT NOT NULL DEFAULT 'Nigeria',
  contact_email TEXT,
  contact_phone TEXT,
  focus_diseases TEXT[] DEFAULT '{}',
  joined_network BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sentinel_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  sentinel_org_id UUID NOT NULL REFERENCES public.sentinel_organizations(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'officer'
    CHECK (role IN ('admin', 'officer', 'viewer', 'field_worker', 'analyst')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sentinel_linked_facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sentinel_org_id UUID NOT NULL REFERENCES public.sentinel_organizations(id) ON DELETE CASCADE,
  facility_name TEXT NOT NULL,
  facility_type TEXT
    CHECK (facility_type IN ('Hospital', 'Clinic', 'PHC', 'Community', 'Laboratory', 'Isolation Center')),
  state TEXT NOT NULL DEFAULT '',
  lga TEXT,
  ward TEXT,
  vitalink_org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  data_sharing_consent BOOLEAN NOT NULL DEFAULT false,
  reporting_frequency TEXT NOT NULL DEFAULT 'weekly'
    CHECK (reporting_frequency IN ('daily', 'weekly', 'monthly', 'on_event')),
  last_report_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sentinel_outbreaks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sentinel_org_id UUID NOT NULL REFERENCES public.sentinel_organizations(id) ON DELETE CASCADE,
  disease TEXT NOT NULL,
  state TEXT NOT NULL,
  lga TEXT,
  severity TEXT NOT NULL DEFAULT 'moderate'
    CHECK (severity IN ('low', 'moderate', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'monitoring', 'resolved', 'false_alarm')),
  cases_confirmed INTEGER NOT NULL DEFAULT 0,
  cases_suspected INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  cfr DECIMAL(5,2),
  start_date DATE,
  end_date DATE,
  response_team_deployed BOOLEAN NOT NULL DEFAULT false,
  intervention_notes TEXT,
  declared_by UUID REFERENCES public.sentinel_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sentinel_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sentinel_org_id UUID NOT NULL REFERENCES public.sentinel_organizations(id) ON DELETE CASCADE,
  report_id TEXT UNIQUE DEFAULT ('CASE-' || to_char(now(), 'YYYY') || '-' || lpad(floor(random()*99999)::text, 5, '0')),
  disease TEXT NOT NULL,
  disease_category TEXT
    CHECK (disease_category IN ('communicable', 'ntd', 'vector_borne', 'chronic', 'vaccine_preventable', 'foodborne', 'zoonotic')),
  state TEXT NOT NULL DEFAULT '',
  lga TEXT,
  facility_id UUID REFERENCES public.sentinel_linked_facilities(id) ON DELETE SET NULL,
  source_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'vitalink_emr_sync', 'community_report', 'lab_notification')),
  age_group TEXT CHECK (age_group IN ('0-5', '6-14', '15-29', '30-49', '50+', 'unknown')),
  sex TEXT CHECK (sex IN ('male', 'female', 'unknown')),
  case_status TEXT NOT NULL DEFAULT 'suspected'
    CHECK (case_status IN ('suspected', 'probable', 'confirmed', 'recovered', 'deceased')),
  lab_confirmed BOOLEAN NOT NULL DEFAULT false,
  symptom_onset_date DATE,
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,
  hospitalized BOOLEAN NOT NULL DEFAULT false,
  linked_outbreak_id UUID REFERENCES public.sentinel_outbreaks(id) ON DELETE SET NULL,
  travel_history BOOLEAN NOT NULL DEFAULT false,
  contact_tracing_initiated BOOLEAN NOT NULL DEFAULT false,
  reported_by UUID REFERENCES public.sentinel_users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.sentinel_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sentinel_org_id UUID NOT NULL REFERENCES public.sentinel_organizations(id) ON DELETE CASCADE,
  type TEXT CHECK (type IN ('outbreak_threshold', 'new_outbreak', 'facility_not_reporting', 'cfr_spike', 'unusual_cluster', 'lab_notification')),
  severity TEXT NOT NULL DEFAULT 'moderate'
    CHECK (severity IN ('low', 'moderate', 'high', 'critical')),
  title TEXT NOT NULL,
  message TEXT,
  state TEXT,
  disease TEXT,
  outbreak_id UUID REFERENCES public.sentinel_outbreaks(id) ON DELETE SET NULL,
  acknowledged BOOLEAN NOT NULL DEFAULT false,
  acknowledged_by UUID REFERENCES public.sentinel_users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_sentinel_users_org ON public.sentinel_users(sentinel_org_id);
CREATE INDEX idx_sentinel_facilities_org ON public.sentinel_linked_facilities(sentinel_org_id);
CREATE INDEX idx_sentinel_facilities_vitalink ON public.sentinel_linked_facilities(vitalink_org_id);
CREATE INDEX idx_sentinel_outbreaks_org ON public.sentinel_outbreaks(sentinel_org_id);
CREATE INDEX idx_sentinel_outbreaks_status ON public.sentinel_outbreaks(status);
CREATE INDEX idx_sentinel_cases_org ON public.sentinel_cases(sentinel_org_id);
CREATE INDEX idx_sentinel_cases_disease ON public.sentinel_cases(disease);
CREATE INDEX idx_sentinel_cases_state ON public.sentinel_cases(state);
CREATE INDEX idx_sentinel_alerts_org ON public.sentinel_alerts(sentinel_org_id);
CREATE INDEX idx_sentinel_alerts_ack ON public.sentinel_alerts(acknowledged);

-- Updated_at triggers
CREATE TRIGGER set_updated_at_sentinel_orgs
  BEFORE UPDATE ON public.sentinel_organizations
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER set_updated_at_sentinel_users
  BEFORE UPDATE ON public.sentinel_users
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER set_updated_at_sentinel_facilities
  BEFORE UPDATE ON public.sentinel_linked_facilities
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER set_updated_at_sentinel_outbreaks
  BEFORE UPDATE ON public.sentinel_outbreaks
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER set_updated_at_sentinel_cases
  BEFORE UPDATE ON public.sentinel_cases
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- Enable RLS on all Sentinel tables
ALTER TABLE public.sentinel_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentinel_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentinel_linked_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentinel_outbreaks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentinel_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sentinel_alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policies: scoped to sentinel_users membership
-- Helper: is the current user a member of this sentinel org?
CREATE OR REPLACE FUNCTION private.is_sentinel_member(p_sentinel_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = private, public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.sentinel_users su
    WHERE su.id = auth.uid()
      AND su.sentinel_org_id = p_sentinel_org_id
      AND su.is_active = true
  )
$$;

CREATE OR REPLACE FUNCTION private.sentinel_admin_roles()
RETURNS TEXT[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['admin'] $$;

-- sentinel_organizations
CREATE POLICY "sentinel_member_read_org"
  ON public.sentinel_organizations FOR SELECT
  USING (private.is_sentinel_member(id));

-- sentinel_users
CREATE POLICY "sentinel_member_read_users"
  ON public.sentinel_users FOR SELECT
  USING (private.is_sentinel_member(sentinel_org_id));

-- sentinel_linked_facilities
CREATE POLICY "sentinel_member_read_facilities"
  ON public.sentinel_linked_facilities FOR SELECT
  USING (private.is_sentinel_member(sentinel_org_id));

CREATE POLICY "sentinel_admin_write_facilities"
  ON public.sentinel_linked_facilities FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sentinel_users su
      WHERE su.id = auth.uid()
        AND su.sentinel_org_id = sentinel_org_id
        AND su.role = 'admin'
    )
  );

-- sentinel_outbreaks
CREATE POLICY "sentinel_member_read_outbreaks"
  ON public.sentinel_outbreaks FOR SELECT
  USING (private.is_sentinel_member(sentinel_org_id));

CREATE POLICY "sentinel_officer_insert_outbreaks"
  ON public.sentinel_outbreaks FOR INSERT
  WITH CHECK (private.is_sentinel_member(sentinel_org_id));

CREATE POLICY "sentinel_officer_update_outbreaks"
  ON public.sentinel_outbreaks FOR UPDATE
  USING (private.is_sentinel_member(sentinel_org_id));

-- sentinel_cases
CREATE POLICY "sentinel_member_read_cases"
  ON public.sentinel_cases FOR SELECT
  USING (private.is_sentinel_member(sentinel_org_id));

CREATE POLICY "sentinel_officer_insert_cases"
  ON public.sentinel_cases FOR INSERT
  WITH CHECK (private.is_sentinel_member(sentinel_org_id));

CREATE POLICY "sentinel_officer_update_cases"
  ON public.sentinel_cases FOR UPDATE
  USING (private.is_sentinel_member(sentinel_org_id));

-- sentinel_alerts
CREATE POLICY "sentinel_member_read_alerts"
  ON public.sentinel_alerts FOR SELECT
  USING (private.is_sentinel_member(sentinel_org_id));

CREATE POLICY "sentinel_member_update_alerts"
  ON public.sentinel_alerts FOR UPDATE
  USING (private.is_sentinel_member(sentinel_org_id));
