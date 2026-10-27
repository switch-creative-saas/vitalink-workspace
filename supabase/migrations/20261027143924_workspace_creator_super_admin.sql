-- Whoever sets up a workspace owns it: they become its super-admin (full access to every
-- module and setting), whatever the workspace type. Existing creators are upgraded too.
do $migration$
declare
  d text := pg_get_functiondef('public.create_workspace(text, text, text, text, text, boolean, text, text)'::regprocedure);
  before text := d;
begin
  d := replace(d, $a$  admin_role := case p_organization_type
    when 'ngo' then 'ngo-admin'
    when 'government' then 'government-admin'
    when 'hmo' then 'public-health-officer'
    when 'insurance' then 'public-health-officer'
    else 'hospital-admin'
  end;$a$, $b$  -- The person who sets up a workspace is its super-admin.
  admin_role := 'super-admin';$b$);
  if d = before then
    raise exception 'create_workspace did not match the expected text; creator role not changed';
  end if;
  execute d;
end;
$migration$;

update public.memberships m
set role = 'super-admin'
from public.organizations o
where m.organization_id = o.id and m.user_id = o.created_by and m.role <> 'super-admin';
