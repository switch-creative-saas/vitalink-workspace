-- Storage upserts (replacing a brand image) also need read access for the uploader.
create policy "VitaLink lists brand assets" on storage.objects
  for select to authenticated using (bucket_id = 'brand' and private.is_platform_admin());
