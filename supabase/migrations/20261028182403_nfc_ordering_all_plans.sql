-- VitaCard ordering is open to every plan. Card setup (linking cards to patients) and the full
-- scan profile are the 'nfc-scanning' entitlement on paid plans; Free scans show a basic profile.
update public.plans set modules = array_append(modules, 'nfc-cards') where id = 'free' and not ('nfc-cards' = any (modules));
update public.plans set modules = array_append(modules, 'nfc-scanning') where id <> 'free' and not ('nfc-scanning' = any (modules));

update public.plans set features = array_replace(features, 'No NFC cards or Sentinel', 'Order VitaCards; scans show a basic profile')
where id = 'free';
update public.plans set features = array_append(array_remove(features, 'No Sentinel'), 'No VitaCard setup or Sentinel')
where id = 'free' and not ('No VitaCard setup or Sentinel' = any (features));
update public.plans set features = array_replace(features, '10 NFC cards included (more at ₦2,500/card)', 'VitaCard scanning & setup with full records; 10 cards included (more at ₦2,500/card)')
where id = 'starter';

create or replace function private.require_nfc_setup()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.nfc_card_id is not null and new.nfc_card_id is distinct from (case when tg_op = 'UPDATE' then old.nfc_card_id end)
     and not ('nfc-scanning' = any ((private.workspace_plan(new.organization_id)).modules)) then
    raise exception 'Linking VitaCards to patients is available on Starter and above. Upgrade to set up cards.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists patients_require_nfc_setup on public.patients;
create trigger patients_require_nfc_setup before insert or update of nfc_card_id on public.patients
  for each row execute function private.require_nfc_setup();
