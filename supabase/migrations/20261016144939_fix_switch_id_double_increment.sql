-- The patients_stamp_creator trigger assigns switch_id on insert, so the column
-- default also calling next_switch_id() burned two serial numbers per patient.
alter table public.patients alter column switch_id drop default;
