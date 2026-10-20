-- Judges may recommend a vertical for the candidate based on the interview.
alter table public.evaluations
  add column preferred_vertical_id uuid references public.verticals (id) on delete set null;
