-- Clearer message when the plan has no pharmacy at all.
create or replace function private.enforce_drug_sku_limit()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_plan public.plans;
begin
  if not new.is_active then return new; end if;
  if tg_op = 'UPDATE' then
    if old.is_active then return new; end if;
  end if;
  v_plan := private.workspace_plan(new.organization_id);
  if v_plan.max_drug_skus is null then return new; end if;
  if v_plan.max_drug_skus = 0 then
    raise exception 'Pharmacy stock isn''t included in the % plan. Upgrade to Starter or above to track drugs.', v_plan.name using errcode = 'P0001';
  end if;
  if (select count(*) from public.drug_inventory where organization_id = new.organization_id and is_active) >= v_plan.max_drug_skus then
    raise exception 'Your % plan tracks up to % drugs. Upgrade to Growth for unlimited pharmacy stock.', v_plan.name, v_plan.max_drug_skus using errcode = 'P0001';
  end if;
  return new;
end;
$$;
