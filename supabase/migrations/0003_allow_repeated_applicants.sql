-- Applicants can apply to more than one vertical, so the same application_id
-- (roll number) may legitimately appear in multiple sheets/vertical records.
-- Identity is still unique per submission via candidates_source_uidx
-- (source_sheet, source_key).

drop index if exists public.candidates_application_id_uidx;

create index if not exists candidates_application_id_idx
  on public.candidates (application_id)
  where application_id is not null;
