-- Imaging reports show who reported them.
alter table public.dx_imaging_reports
  add constraint dx_imaging_reports_reported_by_fkey foreign key (reported_by) references public.profiles(id) on delete set null;
