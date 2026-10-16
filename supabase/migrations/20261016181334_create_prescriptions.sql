-- Applied directly to the live project from Claude chat on 2026-10-16; copied here verbatim
-- from supabase_migrations.schema_migrations so the repo matches the database.

CREATE TABLE public.prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  note_id UUID REFERENCES public.clinical_notes(id) ON DELETE SET NULL,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  prescribed_by UUID REFERENCES auth.users(id),
  drug_name TEXT NOT NULL,
  generic_name TEXT,
  dosage TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL DEFAULT '',
  duration TEXT,
  quantity INTEGER,
  route TEXT NOT NULL DEFAULT 'oral'
    CHECK (route IN ('oral', 'iv', 'im', 'topical', 'inhaled', 'sublingual', 'rectal', 'nasal', 'ophthalmic', 'otic')),
  instructions TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'dispensed', 'cancelled', 'expired')),
  dispensed_at TIMESTAMPTZ,
  dispensed_by UUID REFERENCES auth.users(id),
  dispensed_quantity INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_prescriptions_org ON public.prescriptions(organization_id);
CREATE INDEX idx_prescriptions_patient ON public.prescriptions(patient_id);
CREATE INDEX idx_prescriptions_note ON public.prescriptions(note_id);
CREATE INDEX idx_prescriptions_appt ON public.prescriptions(appointment_id);
CREATE INDEX idx_prescriptions_status ON public.prescriptions(status);

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read_prescriptions"
  ON public.prescriptions FOR SELECT
  USING (private.is_member(organization_id));

CREATE POLICY "clinical_write_prescriptions"
  ON public.prescriptions FOR INSERT
  WITH CHECK (private.has_role(organization_id, private.note_write_roles()));

CREATE POLICY "clinical_update_prescriptions"
  ON public.prescriptions FOR UPDATE
  USING (private.has_role(organization_id, private.note_write_roles()));

CREATE POLICY "admin_delete_prescriptions"
  ON public.prescriptions FOR DELETE
  USING (private.has_role(organization_id, private.admin_roles()));

CREATE TRIGGER set_updated_at_prescriptions
  BEFORE UPDATE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
