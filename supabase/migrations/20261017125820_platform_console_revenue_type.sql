-- sum(bigint) is numeric; console_workspaces returns revenue_kobo as bigint.
do $$
declare
  def text := pg_get_functiondef('public.console_workspaces(text)'::regprocedure);
begin
  def := replace(def,
    $old$(select coalesce(sum(pay.amount_kobo), 0) from public.payments pay where pay.organization_id = o.id and pay.status = 'success')
           + (select coalesce(sum(n.total_kobo), 0) from public.nfc_card_orders n where n.organization_id = o.id and n.paid_at is not null and n.status <> 'cancelled')$old$,
    $new$((select coalesce(sum(pay.amount_kobo), 0) from public.payments pay where pay.organization_id = o.id and pay.status = 'success')
           + (select coalesce(sum(n.total_kobo), 0) from public.nfc_card_orders n where n.organization_id = o.id and n.paid_at is not null and n.status <> 'cancelled'))::bigint$new$);
  if def !~ '\)\)::bigint' then
    raise exception 'console_workspaces revenue expression not found';
  end if;
  execute def;
end;
$$;
