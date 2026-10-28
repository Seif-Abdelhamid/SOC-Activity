-- =====================================================================
-- Runs the "sentinel" server function every minute (alerts, Splunk, retention).
-- Do this AFTER deploying the functions (see README > "Alerts, Splunk and tool snapshots").
--
-- 1) Dashboard > Database > Extensions: enable pg_cron and pg_net.
-- 2) Replace the two placeholders below, then run this whole file once in the SQL Editor.
--    <PROJECT_REF>    the part before .supabase.co in your project URL
--    <SENTINEL_KEY>   the same random value you saved as the SENTINEL_KEY function secret
-- The key is stored encrypted in Supabase Vault, not in this file or the job text.
-- =====================================================================
select vault.create_secret('<SENTINEL_KEY>', 'sentinel_key', 'Shared key for the SOC Log sentinel function')
where not exists (select 1 from vault.secrets where name = 'sentinel_key');

select cron.unschedule('soc-sentinel') where exists (select 1 from cron.job where jobname = 'soc-sentinel');
select cron.schedule('soc-sentinel', '* * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/sentinel',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-sentinel-key', (select decrypted_secret from vault.decrypted_secrets where name = 'sentinel_key')),
    body := '{}'::jsonb, timeout_milliseconds := 25000);
$$);

-- Check it's running (a row per minute, status 200):
--   select status_code, content::text, created from net._http_response order by created desc limit 5;
