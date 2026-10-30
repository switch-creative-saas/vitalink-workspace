-- Patient photos taken or uploaded at registration. They live in the private patient-documents
-- bucket under <organization>/patient-photos/, and the staff who register patients (front desk
-- included) may add and view them there. Other patient files keep their stricter rules.
drop policy if exists "registration staff upload patient photos" on storage.objects;
create policy "registration staff upload patient photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'patient-documents' and split_part(name, '/', 2) = 'patient-photos'
              and private.has_role(private.object_org(name), private.clinical_write_roles()));

drop policy if exists "registration staff read patient photos" on storage.objects;
create policy "registration staff read patient photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'patient-documents' and split_part(name, '/', 2) = 'patient-photos'
         and private.has_role(private.object_org(name), private.clinical_write_roles()));
