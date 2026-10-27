-- The dashboard counts confirmed cases the same way outbreaks do: laboratory-confirmed
-- or classified confirmed (a lab-confirmed patient who died is still a confirmed case).
do $migration$
declare
  d text := pg_get_functiondef('public.sentinel_dashboard(uuid, integer)'::regprocedure);
  before text := d;
begin
  d := replace(d, $a$'confirmedCases', (select count(*) from cases where report_date >= v_from and case_status = 'confirmed'),$a$,
                  $b$'confirmedCases', (select count(*) from cases where report_date >= v_from and (lab_confirmed or case_status = 'confirmed')),$b$);
  if d = before then raise exception 'sentinel_dashboard did not match the expected text'; end if;
  execute d;
end;
$migration$;
