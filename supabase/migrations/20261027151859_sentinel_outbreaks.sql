-- Sentinel outbreaks: counts follow the linked cases (plus any figures known before
-- tracking began), every change is kept in the outbreak's history, declaring raises an
-- alert, and possible outbreaks are detected from the case stream.
-- Admins and officers declare and manage outbreaks; everyone else in the organisation reads.

alter table public.sentinel_outbreaks
  add column disease_id text references public.sentinel_diseases(id),
  add column description text,
  add column baseline_confirmed int not null default 0 check (baseline_confirmed >= 0),
  add column baseline_suspected int not null default 0 check (baseline_suspected >= 0),
  add column baseline_deaths int not null default 0 check (baseline_deaths >= 0);

create table public.sentinel_outbreak_events (
  id uuid primary key default gen_random_uuid(),
  outbreak_id uuid not null references public.sentinel_outbreaks(id) on delete cascade,
  sentinel_org_id uuid not null references public.sentinel_organizations(id) on delete cascade,
  kind text not null check (kind in ('declared', 'severity', 'status', 'response', 'update', 'cases_linked', 'figures')),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  actor_name text,
  created_at timestamptz not null default now()
);
create index sentinel_outbreak_events_idx on public.sentinel_outbreak_events (outbreak_id, created_at);
alter table public.sentinel_outbreak_events enable row level security;
create policy sentinel_outbreak_events_read on public.sentinel_outbreak_events for select to authenticated
  using (private.is_sentinel_member(sentinel_org_id));
revoke insert, update, delete on public.sentinel_outbreak_events from authenticated, anon;

drop policy if exists sentinel_officer_insert_outbreaks on public.sentinel_outbreaks;
drop policy if exists sentinel_officer_update_outbreaks on public.sentinel_outbreaks;
revoke insert, update, delete, truncate on public.sentinel_outbreaks from authenticated, anon;

create or replace function private.sentinel_can_declare(p_sentinel_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sentinel_users where id = auth.uid() and sentinel_org_id = p_sentinel_org and is_active
                 and role in ('admin', 'officer'))
$$;

create or replace function private.sentinel_outbreak_event(p_outbreak uuid, p_kind text, p_detail jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.sentinel_outbreak_events (outbreak_id, sentinel_org_id, kind, detail, actor_id, actor_name)
  select o.id, o.sentinel_org_id, p_kind, p_detail, a.actor_id, coalesce(a.actor_name, 'Sentinel')
  from public.sentinel_outbreaks o, private.sentinel_actor() a where o.id = p_outbreak
$$;

-- Confirmed = laboratory-confirmed or classified confirmed; deaths = deceased; CFR = deaths / confirmed.
create or replace function private.sentinel_refresh_outbreak(p_outbreak uuid)
returns void language sql security definer set search_path = '' as $$
  update public.sentinel_outbreaks o set
    cases_confirmed = o.baseline_confirmed + c.confirmed,
    cases_suspected = o.baseline_suspected + c.suspected,
    deaths = o.baseline_deaths + c.deaths,
    cfr = case when o.baseline_confirmed + c.confirmed > 0
               then round(100.0 * (o.baseline_deaths + c.deaths) / (o.baseline_confirmed + c.confirmed), 1) end,
    updated_at = now()
  from (
    select count(*) filter (where lab_confirmed or case_status = 'confirmed') confirmed,
           count(*) filter (where not (lab_confirmed or case_status = 'confirmed') and case_status in ('suspected', 'probable')) suspected,
           count(*) filter (where case_status = 'deceased') deaths
    from public.sentinel_cases where linked_outbreak_id = p_outbreak
  ) c
  where o.id = p_outbreak
$$;

create or replace function private.sentinel_cases_refresh_outbreaks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.linked_outbreak_id is not null then
    perform private.sentinel_refresh_outbreak(old.linked_outbreak_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.linked_outbreak_id is not null
     and (tg_op = 'INSERT' or new.linked_outbreak_id is distinct from old.linked_outbreak_id
          or new.case_status is distinct from old.case_status or new.lab_confirmed is distinct from old.lab_confirmed) then
    perform private.sentinel_refresh_outbreak(new.linked_outbreak_id);
  end if;
  return null;
end;
$$;
create trigger sentinel_cases_refresh_outbreaks after insert or update or delete on public.sentinel_cases
  for each row execute function private.sentinel_cases_refresh_outbreaks();

/** Links this organisation's unlinked cases of the same disease and place reported since 21 days before the start. */
create or replace function private.sentinel_link_matching(p_outbreak uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_o public.sentinel_outbreaks; v_count int;
begin
  select * into v_o from public.sentinel_outbreaks where id = p_outbreak;
  update public.sentinel_cases c set linked_outbreak_id = v_o.id, updated_at = now()
  where c.sentinel_org_id = v_o.sentinel_org_id and c.linked_outbreak_id is null
    and c.disease_id = v_o.disease_id and lower(c.state) = lower(v_o.state)
    and (v_o.lga is null or c.lga is null or lower(c.lga) = lower(v_o.lga))
    and c.report_date >= coalesce(v_o.start_date, current_date) - 21;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.sentinel_outbreak_event(p_outbreak, 'cases_linked', jsonb_build_object('count', v_count));
  end if;
  perform private.sentinel_refresh_outbreak(p_outbreak);
  return v_count;
end;
$$;

/**
 * p_outbreak: { disease, state, lga, severity, start_date, description, response_team_deployed,
 *   baseline_confirmed, baseline_suspected, baseline_deaths, link_matching (default true) }
 */
create or replace function public.sentinel_declare_outbreak(p_sentinel_org uuid, p_outbreak jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_disease text := private.sentinel_resolve_disease(p_outbreak ->> 'disease');
  v_name text;
  v_state text := nullif(btrim(p_outbreak ->> 'state'), '');
  v_lga text := nullif(btrim(p_outbreak ->> 'lga'), '');
  v_severity text := coalesce(nullif(p_outbreak ->> 'severity', ''), 'moderate');
  v_id uuid;
  v_linked int := 0;
begin
  if not private.sentinel_can_declare(p_sentinel_org) then
    raise exception 'Only Sentinel admins and officers can declare outbreaks' using errcode = '42501';
  end if;
  if v_disease is null then raise exception 'Choose a disease from the registry' using errcode = '22023'; end if;
  if v_state is null then raise exception 'Choose the state' using errcode = '22023'; end if;
  if v_severity not in ('low', 'moderate', 'high', 'critical') then raise exception 'Unknown severity' using errcode = '22023'; end if;
  select name into v_name from public.sentinel_diseases where id = v_disease;

  if exists (select 1 from public.sentinel_outbreaks where sentinel_org_id = p_sentinel_org and disease_id = v_disease
             and lower(state) = lower(v_state) and coalesce(lower(lga), '') = coalesce(lower(v_lga), '') and status in ('active', 'monitoring')) then
    raise exception 'There is already an open % outbreak for %. Add an update to it instead.', v_name, coalesce(v_lga || ', ', '') || v_state
      using errcode = '23505';
  end if;

  insert into public.sentinel_outbreaks (sentinel_org_id, disease, disease_id, state, lga, severity, status, start_date, description,
    response_team_deployed, baseline_confirmed, baseline_suspected, baseline_deaths, declared_by)
  values (p_sentinel_org, v_name, v_disease, v_state, v_lga, v_severity, 'active',
    coalesce(nullif(p_outbreak ->> 'start_date', '')::date, current_date), nullif(btrim(p_outbreak ->> 'description'), ''),
    coalesce((p_outbreak ->> 'response_team_deployed')::boolean, false),
    greatest(coalesce((p_outbreak ->> 'baseline_confirmed')::int, 0), 0), greatest(coalesce((p_outbreak ->> 'baseline_suspected')::int, 0), 0),
    greatest(coalesce((p_outbreak ->> 'baseline_deaths')::int, 0), 0), auth.uid())
  returning id into v_id;

  perform private.sentinel_outbreak_event(v_id, 'declared', jsonb_build_object('severity', v_severity, 'description', p_outbreak ->> 'description'));
  if coalesce((p_outbreak ->> 'link_matching')::boolean, true) then v_linked := private.sentinel_link_matching(v_id); end if;
  perform private.sentinel_refresh_outbreak(v_id);

  insert into public.sentinel_alerts (sentinel_org_id, type, severity, title, message, state, disease, outbreak_id)
  values (p_sentinel_org, 'new_outbreak', v_severity, format('%s outbreak declared in %s', v_name, coalesce(v_lga || ', ', '') || v_state),
          coalesce(nullif(btrim(p_outbreak ->> 'description'), ''), format('%s case(s) linked so far.', v_linked)), v_state, v_name, v_id);

  return jsonb_build_object('id', v_id, 'linked', v_linked);
end;
$$;

/** Severity, status (resolved / false_alarm close it), response team, figures known before tracking, description. */
create or replace function public.sentinel_update_outbreak(p_outbreak uuid, p_changes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_o public.sentinel_outbreaks; v_status text := p_changes ->> 'status';
begin
  select * into v_o from public.sentinel_outbreaks where id = p_outbreak for update;
  if v_o.id is null then raise exception 'Outbreak not found' using errcode = 'P0002'; end if;
  if not private.sentinel_can_declare(v_o.sentinel_org_id) then
    raise exception 'Only Sentinel admins and officers can manage outbreaks' using errcode = '42501';
  end if;
  if p_changes ? 'severity' and p_changes ->> 'severity' not in ('low', 'moderate', 'high', 'critical') then
    raise exception 'Unknown severity' using errcode = '22023';
  end if;
  if v_status is not null and v_status not in ('active', 'monitoring', 'resolved', 'false_alarm') then
    raise exception 'Unknown status' using errcode = '22023';
  end if;

  update public.sentinel_outbreaks set
    severity = coalesce(p_changes ->> 'severity', severity),
    status = coalesce(v_status, status),
    end_date = case when v_status in ('resolved', 'false_alarm') then coalesce(nullif(p_changes ->> 'end_date', '')::date, current_date)
                    when v_status in ('active', 'monitoring') then null else end_date end,
    response_team_deployed = coalesce((p_changes ->> 'response_team_deployed')::boolean, response_team_deployed),
    baseline_confirmed = case when p_changes ? 'baseline_confirmed' then greatest(coalesce((p_changes ->> 'baseline_confirmed')::int, 0), 0) else baseline_confirmed end,
    baseline_suspected = case when p_changes ? 'baseline_suspected' then greatest(coalesce((p_changes ->> 'baseline_suspected')::int, 0), 0) else baseline_suspected end,
    baseline_deaths = case when p_changes ? 'baseline_deaths' then greatest(coalesce((p_changes ->> 'baseline_deaths')::int, 0), 0) else baseline_deaths end,
    description = case when p_changes ? 'description' then nullif(btrim(p_changes ->> 'description'), '') else description end,
    updated_at = now()
  where id = p_outbreak;

  if p_changes ? 'severity' and p_changes ->> 'severity' is distinct from v_o.severity then
    perform private.sentinel_outbreak_event(p_outbreak, 'severity', jsonb_build_object('from', v_o.severity, 'to', p_changes ->> 'severity'));
  end if;
  if v_status is not null and v_status is distinct from v_o.status then
    perform private.sentinel_outbreak_event(p_outbreak, 'status', jsonb_build_object('from', v_o.status, 'to', v_status, 'note', p_changes ->> 'note'));
  end if;
  if p_changes ? 'response_team_deployed' and (p_changes ->> 'response_team_deployed')::boolean is distinct from v_o.response_team_deployed then
    perform private.sentinel_outbreak_event(p_outbreak, 'response', jsonb_build_object('deployed', (p_changes ->> 'response_team_deployed')::boolean));
  end if;
  if p_changes ?| array['baseline_confirmed', 'baseline_suspected', 'baseline_deaths'] then
    perform private.sentinel_outbreak_event(p_outbreak, 'figures', p_changes - 'note' - 'status' - 'severity' - 'response_team_deployed' - 'description');
  end if;
  perform private.sentinel_refresh_outbreak(p_outbreak);
end;
$$;

create or replace function public.sentinel_add_outbreak_update(p_outbreak uuid, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select sentinel_org_id into v_org from public.sentinel_outbreaks where id = p_outbreak;
  if v_org is null then raise exception 'Outbreak not found' using errcode = 'P0002'; end if;
  if not private.sentinel_can_report(v_org) then
    raise exception 'Your Sentinel role can view outbreaks but not post updates' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_text, ''))) = 0 then raise exception 'Write the update first' using errcode = '22023'; end if;
  perform private.sentinel_outbreak_event(p_outbreak, 'update', jsonb_build_object('text', left(btrim(p_text), 4000)));
end;
$$;

create or replace function public.sentinel_link_matching_cases(p_outbreak uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select sentinel_org_id into v_org from public.sentinel_outbreaks where id = p_outbreak;
  if v_org is null then raise exception 'Outbreak not found' using errcode = 'P0002'; end if;
  if not private.sentinel_can_declare(v_org) then
    raise exception 'Only Sentinel admins and officers can manage outbreaks' using errcode = '42501';
  end if;
  return private.sentinel_link_matching(p_outbreak);
end;
$$;

/**
 * Possible outbreaks, from this organisation's cases of the last 28 days that aren't covered by an
 * open outbreak (same disease and state):
 *   - a notifiable epidemic-prone disease with at least one confirmed case or death this week, or
 *   - at least 5 cases this week and at least twice the weekly average of the 3 weeks before.
 */
create or replace function public.sentinel_outbreak_signals(p_sentinel_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.is_sentinel_member(p_sentinel_org) then
    raise exception 'Not a member of this Sentinel organisation' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(s order by s.rank, s.this_week desc), '[]') into v_result from (
    select c.disease_id, d.name as disease, c.state,
      count(*) filter (where c.report_date >= current_date - 6) as this_week,
      round(count(*) filter (where c.report_date < current_date - 6) / 3.0, 1) as weekly_average_before,
      count(*) filter (where c.report_date >= current_date - 6 and (c.lab_confirmed or c.case_status = 'confirmed')) as confirmed,
      count(*) filter (where c.report_date >= current_date - 6 and c.case_status = 'deceased') as deaths,
      min(coalesce(c.symptom_onset_date, c.report_date)) filter (where c.report_date >= current_date - 6) as first_onset,
      (array_agg(c.lga order by c.report_date desc) filter (where c.lga is not null))[1] as lga,
      case
        when d.notifiable and d.category = 'infectious'
             and count(*) filter (where c.report_date >= current_date - 6 and (c.lab_confirmed or c.case_status in ('confirmed', 'deceased'))) > 0
          then 'Notifiable disease with confirmed cases or deaths this week'
        else format('%s cases this week, up from an average of %s a week', count(*) filter (where c.report_date >= current_date - 6),
                    round(count(*) filter (where c.report_date < current_date - 6) / 3.0, 1))
      end as reason,
      case
        when count(*) filter (where c.report_date >= current_date - 6 and c.case_status = 'deceased') > 0
             or count(*) filter (where c.report_date >= current_date - 6) >= 20 then 'critical'
        when count(*) filter (where c.report_date >= current_date - 6) >= 10
             or count(*) filter (where c.report_date >= current_date - 6 and (c.lab_confirmed or c.case_status = 'confirmed')) >= 3 then 'high'
        else 'moderate'
      end as severity,
      case when d.notifiable then 0 else 1 end as rank
    from public.sentinel_cases c
    join public.sentinel_diseases d on d.id = c.disease_id
    where c.sentinel_org_id = p_sentinel_org and c.report_date >= current_date - 27 and c.linked_outbreak_id is null
      and not exists (select 1 from public.sentinel_outbreaks o where o.sentinel_org_id = p_sentinel_org and o.disease_id = c.disease_id
                      and lower(o.state) = lower(c.state) and o.status in ('active', 'monitoring'))
    group by c.disease_id, d.name, d.notifiable, d.category, c.state
    having (d.notifiable and d.category = 'infectious'
            and count(*) filter (where c.report_date >= current_date - 6 and (c.lab_confirmed or c.case_status in ('confirmed', 'deceased'))) > 0)
        or (count(*) filter (where c.report_date >= current_date - 6) >= 5
            and count(*) filter (where c.report_date >= current_date - 6) >= 2 * greatest(count(*) filter (where c.report_date < current_date - 6) / 3.0, 1))
  ) s;
  return v_result;
end;
$$;

revoke execute on function public.sentinel_declare_outbreak(uuid, jsonb), public.sentinel_update_outbreak(uuid, jsonb),
  public.sentinel_add_outbreak_update(uuid, text), public.sentinel_link_matching_cases(uuid), public.sentinel_outbreak_signals(uuid) from public, anon;
grant execute on function public.sentinel_declare_outbreak(uuid, jsonb), public.sentinel_update_outbreak(uuid, jsonb),
  public.sentinel_add_outbreak_update(uuid, text), public.sentinel_link_matching_cases(uuid), public.sentinel_outbreak_signals(uuid) to authenticated;
