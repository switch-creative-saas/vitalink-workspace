-- The billing desk updates live: every charge, payment or finalize touches its invoice row.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoices') then
    alter publication supabase_realtime add table public.invoices;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'invoice_payments') then
    alter publication supabase_realtime add table public.invoice_payments;
  end if;
end $$;
