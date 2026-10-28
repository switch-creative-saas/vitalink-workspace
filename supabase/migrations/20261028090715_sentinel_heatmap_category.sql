-- The heatmap's disease-group filter uses the registry's groups (infectious / ntd / ncd), not the case's own category.
-- (Already part of 20261028090207_sentinel_heatmap.sql in this repo; this patched the function where it was applied first.)
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.sentinel_heatmap(uuid, integer, text, text)'::regprocedure) into v_def;
  if position('c.disease_category = p_category' in v_def) = 0 then
    return;
  end if;
  v_def := replace(v_def, '(p_category is null or c.disease_category = p_category)',
    '(p_category is null or c.disease_id in (select d.id from public.sentinel_diseases d where d.category = p_category))');
  v_def := replace(v_def, E'and (p_disease is null or o.disease_id = p_disease)\n  ),',
    E'and (p_disease is null or o.disease_id = p_disease)\n      and (p_category is null or o.disease_id in (select d.id from public.sentinel_diseases d where d.category = p_category))\n  ),');
  execute v_def;
end $$;
