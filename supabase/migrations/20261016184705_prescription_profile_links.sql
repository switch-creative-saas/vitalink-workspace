-- Lets the API embed prescriber / dispenser names from profiles.
alter table public.prescriptions
  add constraint prescriptions_prescriber_profile_fk foreign key (prescribed_by) references public.profiles (id) on delete set null,
  add constraint prescriptions_dispenser_profile_fk foreign key (dispensed_by) references public.profiles (id) on delete set null;
