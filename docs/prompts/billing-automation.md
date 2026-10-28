# Automatic billing — Claude Code prompts

Run these in order, one per session. Each one builds on what VitaLink already has, so none of them recreate tables.

**How it works:** a clinical action (lab test ordered, drug dispensed, visit checked in) fires a database trigger. The trigger prices the action from the hospital's price list and adds a line to the patient's open bill for that visit. The bill totals recalculate, and the billing desk sees the change live.

**What already exists, and must be reused:**

- **`service_prices`** — the hospital price list. Columns: category, name, price_kobo, is_active. It's edited in Billing → Price List. `private.price_for(org, category, name)` looks prices up and falls back to a "default" row, then 0.
- **`drug_inventory.unit_price_kobo`** — drug selling prices, set in Pharmacy.
- **`invoices`** — columns include patient_id, appointment_id, total_amount_kobo, amount_paid_kobo, discount_kobo and status. Status is one of unpaid, partial, paid, void, refunded.
- **`invoice_line_items`** — columns: invoice_id, description, category, quantity, unit_price_kobo, total_kobo, source_type, source_id. Source types are 'appointment', 'lab_result' and 'prescription'.
- **`invoice_payments`** — patient payments, including the received_by column.
- **`payments`** — Paystack subscription payments for the plans. **Do not touch it.**
- **Supporting pieces:**
  - `preview_unbilled_items(patient)` and the build-invoice RPC: today's manual "pull unbilled items" flow.
  - `private.billing_write_roles()`.
  - The Billing page lives in `src/components/billing/BillingWorkspace.tsx`, with data calls in `src/lib/supabase/billing.ts`.
- **Clinical sources:**
  - `lab_results` holds one row per test, linked to `lab_orders` by order_id.
  - `prescriptions` holds one row per drug, with quantity, status and dispensed_quantity.
  - `appointments` holds the visits.

---

## Prompt 1 — Price list upgrades

```
VitaLink (Supabase project ynbdsrazaplzsrllfgym). Read supabase/migrations for service_prices, invoices,
invoice_line_items and private.price_for before changing anything. All money is bigint kobo.

Extend the existing price list rather than creating a new catalog table:
1. service_prices: add `code text` (optional short code like LAB_FBC, unique per organization when set) and
   `unit text default 'each'` (test, session, day...). Keep the existing category check, and add 'radiology' only if
   you also update every place that lists categories (BillingWorkspace PRICE_CATEGORIES, price_for callers).
2. Update private.price_for to match in this order: exact code, exact name (case-insensitive), then the category's
   "default" row, then 0. Keep its signature backwards compatible.
3. Drugs stay priced from drug_inventory.unit_price_kobo. Add private.drug_price_for(org, drug_name, generic_name),
   which returns the active stock item's unit_price_kobo, matching on drug_name, then generic_name, case-insensitive.
   It returns 0 if nothing matches.
4. Apply with apply_migration, save the file under the version recorded in supabase_migrations.schema_migrations,
   and smoke-test the lookups in a DO block that raises 'RESULT ...' so nothing is committed.
```

## Prompt 2 — The automation triggers

```
VitaLink (ynbdsrazaplzsrllfgym). Make billing automatic. Reuse invoices / invoice_line_items / invoice_payments /
service_prices / drug_inventory; do NOT create new invoice or payment tables (public.payments is Paystack
subscriptions). Money is bigint kobo. SECURITY DEFINER functions with set search_path = ''.

1. Open bills. Add 'draft' to invoices.status. A draft is the running bill for one visit:
   private.open_invoice_for(org, patient, appointment) returns the draft for (patient, appointment). Use the
   patient's draft from today when appointment is null. Create one if none exists, numbered like the existing
   invoice numbers. Add a partial unique index so there is only one draft per (organization, patient, appointment).
2. private.recalculate_invoice(invoice): total_amount_kobo = sum(line total_kobo) - discount_kobo (never below 0).
   Set status from amount_paid_kobo: a draft stays a draft, otherwise unpaid / partial / paid.
3. Triggers. Each one adds a line only once per source (check source_type + source_id), and only while the
   invoice is a draft:
   - lab_results AFTER INSERT → one line, category 'lab', price from price_for(org, 'lab', test_name),
     linked to the order's visit when known.
   - prescriptions AFTER UPDATE when it becomes dispensed → category 'pharmacy', quantity = dispensed_quantity,
     price from drug_price_for. (Bill on dispense, not on prescribe, so undispensed drugs are never charged.
     Add 'pharmacy' to the line-item category check if it's missing.)
   - appointments AFTER UPDATE when checked in → one consultation line, priced like preview_unbilled_items does.
   - Reversals: a lab order cancelled, a prescription cancelled or un-dispensed, or a visit cancelled removes
     that source's line if the invoice is still a draft. Otherwise it leaves the line and adds nothing.
4. Unpriced items still get a line at ₦0, with the description ending in "(no price set)", so the desk can see it.
5. invoice_payments AFTER INSERT/DELETE → amount_paid_kobo = sum of payments, then recalculate. Check whether
   recordPayment already does this, and replace it rather than double counting.
6. billing_finalize_invoice(invoice) RPC (billing roles only): draft → unpaid, with a due date. Also finalize
   automatically when the visit is marked completed.
7. Keep preview_unbilled_items / build-invoice working for anything that happened before this migration (backfill:
   open drafts for visits that are still active and add their unbilled items).
8. Test in a rolled-back DO block:
   - insert a lab result: a line appears at the price-list price;
   - dispense a prescription: a line appears with the stock price;
   - cancel the lab order: the line goes;
   - pay part of the bill: status becomes partial;
   - finalize: status becomes unpaid.
   Report the RESULT line.
```

## Prompt 3 — Price list screen

```
VitaLink frontend. Improve the existing Price List tab in src/components/billing/BillingWorkspace.tsx (and
src/lib/supabase/billing.ts). Don't create a separate settings page; billing staff already go here.

- Tabs or a filter for category (Consultation, Lab, Procedure, Imaging, Room, Supplies, Other).
  Add a "Drugs" view that lists drug_inventory selling prices, editable by pharmacy and admin roles.
- Inline price edit (click → input, Enter/blur saves, Esc cancels), an active toggle, and code and unit columns.
- "Add service" dialog, search, and CSV import (code, name, category, price, unit). The import upserts on code,
  or on name + category, then shows how many were added, updated or skipped.
- A banner: "These prices are used automatically when lab tests are ordered, drugs are dispensed and patients
  check in." Also list the items billed at ₦0 in the last 30 days with a "Set price" button, so gaps get fixed.
- Only billing write roles can edit; everyone else sees read-only. Match the existing component patterns.
- Typecheck, lint, then verify in the browser preview.
```

## Prompt 4 — Live billing desk

```
VitaLink frontend, src/components/billing/BillingWorkspace.tsx. Build on the existing Invoices / Payments / Claims
tabs; don't start a new page.

- New "Open bills" view (drafts plus unpaid and partial): patient, visit date, item count, total, paid, balance,
  status badge (draft grey, unpaid amber, partial orange, paid green, void slate), and when it was last updated.
- Drawer with line items grouped by source (Visit, Lab, Pharmacy, Manual). Show "auto" on lines a trigger added,
  linking each to its lab order or prescription. Allow manual lines, discounts and finalize.
- Record payment uses the existing recordPayment and invoice_payments, with the methods already allowed.
  Waive = a payment with method 'waiver'.
- Realtime: subscribe to invoices and invoice_line_items for the organization, so a lab order or dispense shows up
  within a second without refreshing. Toast "New charge: FBC for Ada Obi".
- Payment history tab: date range filter and CSV export.
- Test end to end in the browser:
  1. order a lab test for a patient;
  2. watch the bill appear;
  3. dispense a drug;
  4. take a part payment;
  5. finalize.
  Then delete the test data you created.
```
