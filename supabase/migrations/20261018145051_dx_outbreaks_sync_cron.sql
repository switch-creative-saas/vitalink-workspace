-- Pull WHO Disease Outbreak News for Nigeria every day at 06:15 WAT (05:15 UTC).
select cron.schedule('vitamind-who-outbreaks-sync', '15 5 * * *', $$
  select net.http_post(
    url := (select value from private.app_config where key = 'functions_base_url') || '/dx-outbreaks-sync',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb);
$$);
