-- Events written in one transaction share a timestamp (e.g. an HMO approval and
-- its payment). Make the page cursor inclusive so a page boundary can't skip one;
-- the client drops the repeated boundary rows.
do $$
declare
  def text := pg_get_functiondef('public.recent_activity(uuid, integer, timestamptz)'::regprocedure);
begin
  execute replace(def, '< before_ts', '<= before_ts');
end;
$$;
