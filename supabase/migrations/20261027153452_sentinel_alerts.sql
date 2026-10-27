-- Sentinel alerts: raised automatically from the case stream and facility reporting, or
-- written by officers as bulletins; acknowledged and resolved through role-checked
-- functions, with who did what kept on the alert. Alerts stream to the app in real time.
--
-- Automatic alerts (each raised once, then updated only by people):
--   lab_notification  a notifiable infectious disease is laboratory-confirmed (one per disease, state and day)
--   cfr_spike         a death from a notifiable disease; critical when its outbreak's CFR reaches 10%
--   unusual_cluster   5+ cases of a disease in a state this week, at least double the weekly average
--                     of the 3 weeks before, with no open outbreak (one per disease, state and week)
--   facility_not_reporting  a sharing facility silent for 14 days (checked daily; at most every 14 days)
--   new_outbreak      raised when an outbreak is declared (sentinel_declare_outbreak)

alter table public.sentinel_alerts drop constraint sentinel_alerts_type_check;
alter table public.sentinel_alerts add constraint sentinel_alerts_type_check check (type in
  ('outbreak_threshold', 'new_outbreak', 'facility_not_reporting', 'cfr_spike', 'unusual_cluster', 'lab_notification', 'bulletin'));

alter table public.sentinel_alerts
  add column status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  add column source text not null default 'system' check (source in ('system', 'manual')),
  add column lga text,
  add column case_id uuid references public.sentinel_cases(id) on delete set null,
  add column facility_id uuid references public.sentinel_linked_facilities(id) on delete set null,
  add column dedupe_key text,
  add column created_by uuid,
  add column created_by_name text,
  add column acknowledged_by_name text,
  add column acknowledged_note text,
  add column resolved_at timestamptz,
  add column resolved_by uuid,
  add column resolved_by_name text,
  add column resolved_note text;
update public.sentinel_alerts set status = case when acknowledged then 'acknowledged' else 'open' end;
create index sentinel_alerts_org_idx on public.sentinel_alerts (sentinel_org_id, status, created_at desc);
create index sentinel_alerts_dedupe_idx on public.sentinel_alerts (sentinel_org_id, dedupe_key);

drop policy if exists sentinel_member_update_alerts on public.sentinel_alerts;
revoke insert, update, delete, truncate on public.sentinel_alerts from authenticated, anon;

-- "acknowledged" stays true for anything no longer open (the dashboard reads it).
create or replace function private.sentinel_alert_sync()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.acknowledged := new.status <> 'open';
  return new;
end;
$$;
create trigger sentinel_alerts_sync before insert or update on public.sentinel_alerts
  for each row execute function private.sentinel_alert_sync();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sentinel_alerts') then
    execute 'alter publication supabase_realtime add table public.sentinel_alerts';
  end if;
end $$;

/** Raises a system alert unless one with the same key was raised within p_window. */
create or replace function private.sentinel_raise_alert(
  p_org uuid, p_type text, p_severity text, p_title text, p_message text, p_state text, p_lga text, p_disease text,
  p_outbreak uuid, p_case uuid, p_facility uuid, p_key text, p_window interval
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_key is not null and exists (select 1 from public.sentinel_alerts where sentinel_org_id = p_org and dedupe_key = p_key
                                   and created_at > now() - p_window) then
    return;
  end if;
  insert into public.sentinel_alerts (sentinel_org_id, type, severity, title, message, state, lga, disease, outbreak_id, case_id, facility_id, dedupe_key, source)
  values (p_org, p_type, p_severity, left(p_title, 200), p_message, p_state, p_lga, p_disease, p_outbreak, p_case, p_facility, p_key, 'system');
end;
$$;

create or replace function private.sentinel_case_alerts()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_d public.sentinel_diseases;
  v_newly_confirmed boolean;
  v_died boolean;
  v_outbreak public.sentinel_outbreaks;
  v_week int; v_before int;
begin
  select * into v_d from public.sentinel_diseases where id = new.disease_id;
  if v_d.id is null then return null; end if;

  v_newly_confirmed := (new.lab_confirmed or new.case_status = 'confirmed')
    and (tg_op = 'INSERT' or not (old.lab_confirmed or old.case_status = 'confirmed'));
  v_died := new.case_status = 'deceased' and (tg_op = 'INSERT' or old.case_status is distinct from 'deceased');

  if v_d.notifiable and v_d.category = 'infectious' and v_newly_confirmed then
    perform private.sentinel_raise_alert(new.sentinel_org_id, 'lab_notification', 'high',
      format('Confirmed %s case in %s', v_d.name, new.state),
      format('Case %s%s was confirmed. %s is a notifiable disease: report to the state epidemiologist within 24 hours.',
             new.report_id, coalesce(' (' || new.lga || ')', ''), v_d.name),
      new.state, new.lga, v_d.name, new.linked_outbreak_id, new.id, null,
      format('lab:%s:%s:%s', v_d.id, lower(new.state), current_date), interval '1 day');
  end if;

  if v_d.notifiable and v_died then
    -- This trigger runs before the one that refreshes outbreak counts, so refresh first to read the current CFR.
    if new.linked_outbreak_id is not null then perform private.sentinel_refresh_outbreak(new.linked_outbreak_id); end if;
    select * into v_outbreak from public.sentinel_outbreaks where id = new.linked_outbreak_id;
    perform private.sentinel_raise_alert(new.sentinel_org_id, 'cfr_spike',
      case when coalesce(v_outbreak.cfr, 0) >= 10 then 'critical' else 'high' end,
      case when v_outbreak.id is not null
           then format('%s death in %s outbreak (CFR %s%%)', v_d.name, v_outbreak.state, coalesce(v_outbreak.cfr::text, '–'))
           else format('Death from %s reported in %s', v_d.name, new.state) end,
      format('Case %s%s died.%s', new.report_id, coalesce(' (' || new.lga || ')', ''),
             case when coalesce(v_outbreak.cfr, 0) >= 10 then ' The outbreak''s case fatality rate is 10% or higher: review case management and referral.' else '' end),
      new.state, new.lga, v_d.name, new.linked_outbreak_id, new.id, null, format('death:%s', new.id), interval '100 years');
  end if;

  if tg_op = 'INSERT' and new.linked_outbreak_id is null and v_d.category <> 'ncd'
     and not exists (select 1 from public.sentinel_outbreaks o where o.sentinel_org_id = new.sentinel_org_id and o.disease_id = v_d.id
                     and lower(o.state) = lower(new.state) and o.status in ('active', 'monitoring')) then
    select count(*) filter (where report_date >= current_date - 6), count(*) filter (where report_date between current_date - 27 and current_date - 7)
      into v_week, v_before
    from public.sentinel_cases
    where sentinel_org_id = new.sentinel_org_id and disease_id = v_d.id and lower(state) = lower(new.state) and report_date >= current_date - 27;
    if v_week >= 5 and v_week >= 2 * greatest(v_before / 3.0, 1) then
      perform private.sentinel_raise_alert(new.sentinel_org_id, 'unusual_cluster', case when v_week >= 20 then 'critical' when v_week >= 10 then 'high' else 'moderate' end,
        format('Unusual rise in %s cases in %s', v_d.name, new.state),
        format('%s cases this week against an average of %s a week before. Review the cases and consider declaring an outbreak.',
               v_week, round(v_before / 3.0, 1)),
        new.state, new.lga, v_d.name, null, null, null, format('cluster:%s:%s:%s', v_d.id, lower(new.state), to_char(current_date, 'IYYY-IW')), interval '7 days');
    end if;
  end if;
  return null;
end;
$$;
create trigger sentinel_cases_alerts after insert or update of case_status, lab_confirmed on public.sentinel_cases
  for each row execute function private.sentinel_case_alerts();

/** Daily: facilities that agreed to share but have sent nothing (cases or symptom counts) for 14 days. */
create or replace function private.sentinel_check_reporting()
returns int language plpgsql security definer set search_path = '' as $$
declare v_f record; v_count int := 0;
begin
  for v_f in
    select f.id, f.sentinel_org_id, f.facility_name, f.state, f.lga,
           greatest(f.last_report_date, (select max(day) from public.sentinel_syndromic_counts s where s.facility_id = f.id), f.consented_at::date) as last_seen
    from public.sentinel_linked_facilities f
    where f.is_active and f.consent_status = 'approved'
  loop
    if v_f.last_seen is null or v_f.last_seen < current_date - 14 then
      perform private.sentinel_raise_alert(v_f.sentinel_org_id, 'facility_not_reporting', 'moderate',
        format('%s has not reported for 14 days', v_f.facility_name),
        format('Nothing has been received from %s since %s. Check with the facility that VitaLink is in use and data sharing is still on.',
               v_f.facility_name, coalesce(to_char(v_f.last_seen, 'DD Mon YYYY'), 'it agreed to share')),
        v_f.state, v_f.lga, null, null, null, v_f.id, format('silent:%s', v_f.id), interval '14 days');
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

select cron.schedule('sentinel-facility-reporting', '0 6 * * *', $$select private.sentinel_check_reporting()$$);

-- ---------------------------------------------------------------------------
-- People acting on alerts

create or replace function public.sentinel_set_alert_status(p_alert uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_a public.sentinel_alerts; v_actor uuid; v_name text;
begin
  select * into v_a from public.sentinel_alerts where id = p_alert for update;
  if v_a.id is null then raise exception 'Alert not found' using errcode = 'P0002'; end if;
  if not private.sentinel_can_report(v_a.sentinel_org_id) then
    raise exception 'Your Sentinel role can view alerts but not act on them' using errcode = '42501';
  end if;
  if p_status not in ('open', 'acknowledged', 'resolved') then raise exception 'Unknown alert status' using errcode = '22023'; end if;
  select actor_id, actor_name into v_actor, v_name from private.sentinel_actor();

  update public.sentinel_alerts set
    status = p_status,
    acknowledged_by = case when p_status = 'acknowledged' then v_actor when p_status = 'open' then null else coalesce(acknowledged_by, v_actor) end,
    acknowledged_by_name = case when p_status = 'acknowledged' then v_name when p_status = 'open' then null else coalesce(acknowledged_by_name, v_name) end,
    acknowledged_at = case when p_status = 'acknowledged' then now() when p_status = 'open' then null else coalesce(acknowledged_at, now()) end,
    acknowledged_note = case when p_status = 'acknowledged' then nullif(btrim(p_note), '') when p_status = 'open' then null else acknowledged_note end,
    resolved_at = case when p_status = 'resolved' then now() end,
    resolved_by = case when p_status = 'resolved' then v_actor end,
    resolved_by_name = case when p_status = 'resolved' then v_name end,
    resolved_note = case when p_status = 'resolved' then nullif(btrim(p_note), '') end
  where id = p_alert;
end;
$$;

/** Bulletins and manual alerts from admins and officers. */
create or replace function public.sentinel_create_alert(p_sentinel_org uuid, p_alert jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid; v_actor uuid; v_name text;
  v_type text := coalesce(nullif(p_alert ->> 'type', ''), 'bulletin');
  v_severity text := coalesce(nullif(p_alert ->> 'severity', ''), 'moderate');
  v_disease text := private.sentinel_resolve_disease(nullif(p_alert ->> 'disease', ''));
begin
  if not private.sentinel_can_declare(p_sentinel_org) then
    raise exception 'Only Sentinel admins and officers can issue alerts' using errcode = '42501';
  end if;
  if v_type not in ('bulletin', 'outbreak_threshold', 'unusual_cluster', 'lab_notification', 'facility_not_reporting', 'cfr_spike') then
    raise exception 'Unknown alert type' using errcode = '22023';
  end if;
  if v_severity not in ('low', 'moderate', 'high', 'critical') then raise exception 'Unknown severity' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_alert ->> 'title', ''))) = 0 then raise exception 'Give the alert a title' using errcode = '22023'; end if;
  select actor_id, actor_name into v_actor, v_name from private.sentinel_actor();
  insert into public.sentinel_alerts (sentinel_org_id, type, severity, title, message, state, lga, disease, outbreak_id, source, created_by, created_by_name)
  values (p_sentinel_org, v_type, v_severity, left(btrim(p_alert ->> 'title'), 200), nullif(btrim(p_alert ->> 'message'), ''),
          nullif(btrim(p_alert ->> 'state'), ''), nullif(btrim(p_alert ->> 'lga'), ''),
          (select name from public.sentinel_diseases where id = v_disease),
          (select id from public.sentinel_outbreaks where id = nullif(p_alert ->> 'outbreak_id', '')::uuid and sentinel_org_id = p_sentinel_org),
          'manual', v_actor, v_name)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.sentinel_set_alert_status(uuid, text, text), public.sentinel_create_alert(uuid, jsonb) from public, anon;
grant execute on function public.sentinel_set_alert_status(uuid, text, text), public.sentinel_create_alert(uuid, jsonb) to authenticated;
