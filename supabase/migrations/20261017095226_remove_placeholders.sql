-- Replace values that were fixed in code or never set:
--  * appointments.outstanding_balance / lab_linked / prescription_ready were
--    never written; they now come from invoices, lab orders and prescriptions.
--  * the HMO micro-fee rate lives on the plan instead of inside a function.
--  * patient documents are stored in a private Storage bucket.

-- ============================================
-- APPOINTMENT CARE FLAGS (derived)
-- ============================================

alter table public.appointments
  drop column outstanding_balance,
  drop column lab_linked,
  drop column prescription_ready;

-- Per-patient aggregates for the appointment board. Any workspace member may
-- see them (reception needs the balance); no invoice or clinical detail is
-- returned.
create or replace function public.patient_care_flags(p_organization_id uuid, p_patient_ids uuid[])
returns table (patient_id uuid, outstanding_kobo bigint, open_lab_orders integer, active_prescriptions integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id,
         coalesce((select sum(greatest(i.total_amount_kobo - i.amount_paid_kobo, 0))
                   from public.invoices i
                   where i.patient_id = p.id and i.status in ('unpaid', 'partial')), 0)::bigint,
         (select count(*) from public.lab_orders o
          where o.patient_id = p.id and o.status in ('pending', 'processing'))::integer,
         (select count(*) from public.prescriptions rx
          where rx.patient_id = p.id and rx.status = 'active')::integer
  from public.patients p
  where p.organization_id = p_organization_id
    and p.id = any (p_patient_ids)
    and private.is_member(p_organization_id)
$$;
revoke execute on function public.patient_care_flags(uuid, uuid[]) from public, anon;
grant execute on function public.patient_care_flags(uuid, uuid[]) to authenticated;

-- ============================================
-- HMO MICRO-FEE ON THE PLAN
-- ============================================

alter table public.plans add column hmo_fee_bps integer not null default 150 check (hmo_fee_bps between 0 and 10000);
update public.plans set hmo_fee_bps = case id when 'enterprise' then 75 when 'growth' then 100 else 150 end;

create or replace function private.hmo_fee_bps(org uuid)
returns integer
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.hmo_fee_bps from public.plans p
     where p.id = coalesce((select private.effective_plan(s) from public.subscriptions s where s.organization_id = org), 'free')),
    (select p.hmo_fee_bps from public.plans p where p.id = 'free'),
    150)
$$;

-- ============================================
-- PATIENT DOCUMENTS (private bucket, path = org/patient/file)
-- ============================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('patient-documents', 'patient-documents', false, 20971520,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic',
              'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'text/plain'])
on conflict (id) do nothing;

create or replace function private.document_upload_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['super-admin','hospital-admin','doctor','nurse','lab-scientist','lab-technician','pharmacist']::text[] $$;
grant execute on function private.document_upload_roles() to authenticated;

create table public.patient_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  patient_id uuid not null,
  name text not null check (char_length(btrim(name)) > 0),
  category text not null default 'External reports'
    check (category in ('Imaging', 'Consent forms', 'Referral letters', 'Discharge summary', 'Insurance files', 'External reports')),
  storage_path text not null unique,
  mime_type text not null default '',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  version integer not null default 1,
  tags text[] not null default '{}',
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (patient_id, organization_id) references public.patients (id, organization_id) on delete cascade
);
create index patient_documents_patient_idx on public.patient_documents (patient_id, organization_id, created_at desc);
create index patient_documents_org_idx on public.patient_documents (organization_id);
create index patient_documents_uploaded_by_idx on public.patient_documents (uploaded_by);

create or replace function private.patient_document_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if split_part(new.storage_path, '/', 1) <> new.organization_id::text
     or split_part(new.storage_path, '/', 2) <> new.patient_id::text then
    raise exception 'Document path must start with the workspace and patient' using errcode = '22023';
  end if;
  new.uploaded_by := auth.uid();
  new.created_at := now();
  -- Re-uploading a file with the same name becomes its next version.
  new.version := coalesce((select max(d.version) from public.patient_documents d
                           where d.patient_id = new.patient_id and lower(d.name) = lower(new.name)), 0) + 1;
  return new;
end;
$$;
create trigger patient_documents_stamp before insert on public.patient_documents
  for each row execute function private.patient_document_stamp();
create trigger patient_documents_audit after insert or update or delete on public.patient_documents
  for each row execute function private.write_audit();

alter table public.patient_documents enable row level security;
create policy "clinical staff read documents" on public.patient_documents
  for select to authenticated using (private.has_role(organization_id, private.clinical_read_roles()));
create policy "clinical staff add documents" on public.patient_documents
  for insert to authenticated with check (private.has_role(organization_id, private.document_upload_roles()));
create policy "admins delete documents" on public.patient_documents
  for delete to authenticated using (private.has_role(organization_id, private.admin_roles()));
revoke all on public.patient_documents from anon;

-- Storage objects: first folder is the workspace id (null for anything else,
-- so a malformed path is denied instead of raising a cast error).
create or replace function private.object_org(object_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              then split_part(object_name, '/', 1)::uuid end
$$;
grant execute on function private.object_org(text) to authenticated;

create policy "clinical staff read patient files" on storage.objects
  for select to authenticated
  using (bucket_id = 'patient-documents'
         and private.has_role(private.object_org(name), private.clinical_read_roles()));
create policy "clinical staff upload patient files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'patient-documents'
              and private.has_role(private.object_org(name), private.document_upload_roles()));
create policy "admins delete patient files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'patient-documents'
         and private.has_role(private.object_org(name), private.admin_roles()));
