-- Storage uploads with upsert (and the RETURNING after insert) need SELECT on the user's own avatar folder.
drop policy if exists "users read own avatar" on storage.objects;
create policy "users read own avatar" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
