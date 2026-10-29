-- Applied directly to the live project on 2026-10-16; copied here verbatim
-- from supabase_migrations.schema_migrations so the repo matches the database.

CREATE TABLE public.drug_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  drug_name TEXT NOT NULL,
  generic_name TEXT,
  category TEXT,
  formulation TEXT CHECK (formulation IN ('Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Vial', 'Cream', 'Ointment', 'Drops', 'Inhaler', 'Patch', 'Suppository', 'Powder', 'Solution')),
  strength TEXT,
  manufacturer TEXT,
  unit_of_measure TEXT NOT NULL DEFAULT 'tablet',
  quantity_in_stock INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 10,
  unit_cost_kobo BIGINT,
  unit_price_kobo BIGINT,
  expiry_date DATE,
  batch_number TEXT,
  supplier TEXT,
  storage_location TEXT,
  nafdac_number TEXT,
  is_controlled BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_drug_inventory_org ON public.drug_inventory(organization_id);
CREATE INDEX idx_drug_inventory_name ON public.drug_inventory(organization_id, drug_name);
CREATE INDEX idx_drug_inventory_stock ON public.drug_inventory(organization_id, quantity_in_stock);

ALTER TABLE public.drug_inventory ENABLE ROW LEVEL SECURITY;

-- Define pharmacist-adjacent roles helper inline
CREATE POLICY "members_read_drug_inventory"
  ON public.drug_inventory FOR SELECT
  USING (private.is_member(organization_id));

CREATE POLICY "pharmacist_insert_drug_inventory"
  ON public.drug_inventory FOR INSERT
  WITH CHECK (private.has_role(organization_id, ARRAY['admin', 'pharmacist', 'super_admin']));

CREATE POLICY "pharmacist_update_drug_inventory"
  ON public.drug_inventory FOR UPDATE
  USING (private.has_role(organization_id, ARRAY['admin', 'pharmacist', 'super_admin']));

CREATE POLICY "admin_delete_drug_inventory"
  ON public.drug_inventory FOR DELETE
  USING (private.has_role(organization_id, private.admin_roles()));

CREATE TRIGGER set_updated_at_drug_inventory
  BEFORE UPDATE ON public.drug_inventory
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
