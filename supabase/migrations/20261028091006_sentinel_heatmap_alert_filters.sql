-- Heatmap: when a disease or disease group is chosen, only count alerts about it.
-- (Already part of 20261028090207_sentinel_heatmap.sql in this repo; this patched the function where it was applied first.)
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.sentinel_heatmap(uuid, integer, text, text)'::regprocedure) into v_def;
  if position('a.disease = (select d.name' in v_def) > 0 then return; end if;
  if position(E'a.status <> ''resolved'' and a.state is not null\n  ),' in v_def) = 0 then
    raise exception 'sentinel_heatmap: expected alerts filter not found';
  end if;
  v_def := replace(v_def, E'a.status <> ''resolved'' and a.state is not null\n  ),',
    E'a.status <> ''resolved'' and a.state is not null\n      and (p_disease is null or a.disease = (select d.name from public.sentinel_diseases d where d.id = p_disease))\n      and (p_category is null or a.disease in (select d.name from public.sentinel_diseases d where d.category = p_category))\n  ),');
  execute v_def;
end $$;
