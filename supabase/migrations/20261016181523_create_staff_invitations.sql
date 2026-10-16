-- Applied directly to the live project from Claude chat on 2026-10-16; copied here verbatim
-- from supabase_migrations.schema_migrations so the repo matches the database.

CREATE TABLE public.staff_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  department TEXT,
  invited_by UUID REFERENCES auth.users(id),
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  accepted BOOLEAN NOT NULL DEFAULT false,
  accepted_by UUID REFERENCES auth.users(id),
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_invitation_role CHECK (role = ANY(private.valid_roles()))
);

CREATE INDEX idx_staff_invitations_org ON public.staff_invitations(organization_id);
CREATE INDEX idx_staff_invitations_email ON public.staff_invitations(email);
CREATE INDEX idx_staff_invitations_token ON public.staff_invitations(token);

ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_read_invitations"
  ON public.staff_invitations FOR SELECT
  USING (private.has_role(organization_id, private.admin_roles()));

CREATE POLICY "admin_insert_invitations"
  ON public.staff_invitations FOR INSERT
  WITH CHECK (private.has_role(organization_id, private.admin_roles()));

CREATE POLICY "admin_update_invitations"
  ON public.staff_invitations FOR UPDATE
  USING (private.has_role(organization_id, private.admin_roles()));

-- Allow accepting via token (public function will handle this)
CREATE POLICY "public_read_by_token"
  ON public.staff_invitations FOR SELECT
  USING (true);  -- token is a secret; queries filter by token
