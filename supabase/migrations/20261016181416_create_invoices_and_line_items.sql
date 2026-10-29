-- Applied directly to the live project on 2026-10-16; copied here verbatim
-- from supabase_migrations.schema_migrations so the repo matches the database.

-- Auto-increment invoice number sequence
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START 1;

CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
  invoice_number TEXT UNIQUE NOT NULL DEFAULT ('INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0')),
  total_amount_kobo BIGINT NOT NULL DEFAULT 0,
  amount_paid_kobo BIGINT NOT NULL DEFAULT 0,
  discount_kobo BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid', 'partial', 'paid', 'void', 'refunded')),
  payment_method TEXT
    CHECK (payment_method IN ('cash', 'card', 'bank_transfer', 'hmo', 'nhis', 'waiver', 'pos')),
  hmo_provider TEXT,
  hmo_policy_number TEXT,
  hmo_claim_status TEXT
    CHECK (hmo_claim_status IN ('pending', 'submitted', 'approved', 'rejected')),
  hmo_micro_fee_kobo BIGINT DEFAULT 0,
  due_date DATE,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT CHECK (category IN ('consultation', 'lab', 'pharmacy', 'procedure', 'room', 'imaging', 'supplies', 'other')),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_kobo BIGINT NOT NULL,
  total_kobo BIGINT GENERATED ALWAYS AS (quantity * unit_price_kobo) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_org ON public.invoices(organization_id);
CREATE INDEX idx_invoices_patient ON public.invoices(patient_id);
CREATE INDEX idx_invoices_status ON public.invoices(organization_id, status);
CREATE INDEX idx_line_items_invoice ON public.invoice_line_items(invoice_id);

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read_invoices"
  ON public.invoices FOR SELECT
  USING (private.is_member(organization_id));

CREATE POLICY "billing_insert_invoices"
  ON public.invoices FOR INSERT
  WITH CHECK (private.has_role(organization_id, ARRAY['admin', 'billing_officer', 'receptionist', 'super_admin']));

CREATE POLICY "billing_update_invoices"
  ON public.invoices FOR UPDATE
  USING (private.has_role(organization_id, ARRAY['admin', 'billing_officer', 'super_admin']));

CREATE POLICY "admin_delete_invoices"
  ON public.invoices FOR DELETE
  USING (private.has_role(organization_id, private.admin_roles()));

-- Line items inherit invoice org scope via JOIN
CREATE POLICY "members_read_line_items"
  ON public.invoice_line_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_id AND private.is_member(i.organization_id)
    )
  );

CREATE POLICY "billing_insert_line_items"
  ON public.invoice_line_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_id
        AND private.has_role(i.organization_id, ARRAY['admin', 'billing_officer', 'receptionist', 'super_admin'])
    )
  );

CREATE POLICY "billing_delete_line_items"
  ON public.invoice_line_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_id
        AND private.has_role(i.organization_id, private.admin_roles())
    )
  );

CREATE TRIGGER set_updated_at_invoices
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
