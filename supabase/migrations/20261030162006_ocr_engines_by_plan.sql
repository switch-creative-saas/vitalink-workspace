-- Two ways to read paper records:
-- * 'ocr-intake' (Starter and up): VitaLink's own reader, on the device; no AI service.
-- * 'ocr-ai' (Growth and up): VitaMind reads the photos with the AI service, for hard
--   handwriting and whole patient cards. Growth plans keep the on-device reader too.
update public.plans set
  modules = (select array_agg(distinct m) from unnest(modules || array['ocr-ai']) m),
  features = features || array['VitaMind AI reading of handwritten records']
where id in ('growth', 'enterprise') and not ('ocr-ai' = any(modules));

update public.plans set
  features = array_replace(features, 'Snap paper records to register patients', 'Import any patient list, or snap register pages (read on your device)')
where id in ('starter', 'growth', 'enterprise');
