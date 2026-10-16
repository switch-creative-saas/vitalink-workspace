-- Applied directly to the live project from Claude chat on 2026-10-16; copied here verbatim
-- from supabase_migrations.schema_migrations so the repo matches the database.

CREATE TABLE public.nfc_card_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  ordered_by UUID REFERENCES auth.users(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  price_per_card_kobo BIGINT NOT NULL DEFAULT 250000,
  subtotal_kobo BIGINT GENERATED ALWAYS AS (quantity * price_per_card_kobo) STORED,
  delivery_fee_kobo BIGINT NOT NULL DEFAULT 0,
  delivery_option TEXT NOT NULL DEFAULT 'delivery'
    CHECK (delivery_option IN ('pickup', 'delivery')),
  delivery_address TEXT,
  delivery_contact_name TEXT,
  delivery_contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'confirmed', 'paid', 'dispatched', 'delivered', 'cancelled')),
  paystack_reference TEXT,
  estimated_delivery_date DATE,
  tracking_number TEXT,
  notes TEXT,
  ordered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_nfc_orders_org ON public.nfc_card_orders(organization_id);
CREATE INDEX idx_nfc_orders_status ON public.nfc_card_orders(status);

ALTER TABLE public.nfc_card_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read_nfc_orders"
  ON public.nfc_card_orders FOR SELECT
  USING (private.is_member(organization_id));

CREATE POLICY "admin_insert_nfc_orders"
  ON public.nfc_card_orders FOR INSERT
  WITH CHECK (private.has_role(organization_id, private.admin_roles()));

CREATE POLICY "admin_update_nfc_orders"
  ON public.nfc_card_orders FOR UPDATE
  USING (private.is_member(organization_id));

CREATE TRIGGER set_updated_at_nfc_orders
  BEFORE UPDATE ON public.nfc_card_orders
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
