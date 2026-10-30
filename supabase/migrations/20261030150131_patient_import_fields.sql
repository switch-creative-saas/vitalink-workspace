-- Patients brought in from other systems or paper keep their old number (card no., hospital no.,
-- MRN, file no.) so staff can still find them by it, and a birth date worked out from an age is
-- marked as estimated.
alter table public.patients
  add column if not exists previous_number text,
  add column if not exists dob_estimated boolean not null default false;

create index if not exists patients_org_previous_number_idx
  on public.patients (organization_id, lower(previous_number))
  where previous_number is not null;
