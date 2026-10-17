-- Public bucket for brand images used in emails (logo, animated header strip).
-- Anyone can read (email clients fetch them); only VitaLink platform admins can
-- upload or replace files. Source files live in supabase/email/assets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand', 'brand', true, 2097152, array['image/png', 'image/gif', 'image/jpeg', 'image/svg+xml', 'image/webp'])
on conflict (id) do nothing;

create policy "VitaLink uploads brand assets" on storage.objects
  for insert to authenticated with check (bucket_id = 'brand' and private.is_platform_admin());
create policy "VitaLink replaces brand assets" on storage.objects
  for update to authenticated using (bucket_id = 'brand' and private.is_platform_admin());
create policy "VitaLink removes brand assets" on storage.objects
  for delete to authenticated using (bucket_id = 'brand' and private.is_platform_admin());
