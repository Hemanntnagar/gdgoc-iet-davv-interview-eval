-- GDGOC IET DAVV Interview Evaluation System — addendum schema
-- Verticals, expanded applicant profiles, interviewer account provisioning,
-- exact 1–5 rubric storage, spreadsheet (workbook) integration state.

-- ---------------------------------------------------------------------------
-- verticals: configurable list. Original workbook tab names preserved verbatim.
-- ---------------------------------------------------------------------------
create table public.verticals (
  id uuid primary key default gen_random_uuid(),
  -- stable machine key, e.g. 'content', 'social-media'
  key text not null unique check (char_length(key) between 1 and 60),
  -- display name exactly as in the workbook / recruitment docs
  name text not null check (char_length(name) between 1 and 80),
  -- workbook worksheet tab this vertical is mapped to (nullable while unmapped)
  worksheet text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.verticals (key, name, sort_order) values
  ('content', 'Content', 1),
  ('marketing', 'Marketing', 2),
  ('creatives', 'Creatives', 3),
  ('social-media', 'Social Media', 4),
  ('design', 'Design', 5),
  ('technical', 'Technical', 6),
  ('production', 'Production', 7),
  ('pr', 'PR', 8),
  ('sponsorship', 'Sponsorship', 9),
  ('operations', 'Operations', 10);

-- ---------------------------------------------------------------------------
-- profiles: interview accounts provisioned by admins (login_id + password via
-- Supabase Auth; plaintext passwords are NEVER stored anywhere).
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column login_id text unique check (login_id is null or char_length(login_id) between 2 and 60),
  add column display_name text not null default '',
  -- verticals this account is authorized for (array of verticals.id)
  add column vertical_ids uuid[] not null default '{}',
  -- optional granular restrictions; empty arrays mean "no restriction"
  add column panel_ids uuid[] not null default '{}',
  add column shift_restrictions text[] not null default '{}',
  add column created_by uuid references public.profiles (id),
  add column password_reset_at timestamptz;

create index profiles_login_id_idx on public.profiles (login_id) where login_id is not null;

-- ---------------------------------------------------------------------------
-- panels: vertical/shift association + numbering for the Panel 1.1 scheme.
-- ---------------------------------------------------------------------------
alter table public.panels
  add column vertical_id uuid references public.verticals (id),
  add column shift text not null default '' check (char_length(shift) <= 40),
  add column panel_number int check (panel_number is null or panel_number >= 1),
  add column description text not null default '';

create index panels_vertical_idx on public.panels (vertical_id);

-- ---------------------------------------------------------------------------
-- candidates: full applicant profile from the workbook. Extra source columns
-- that are not modelled explicitly are preserved verbatim in source_extra.
-- ---------------------------------------------------------------------------
alter table public.candidates
  add column vertical_id uuid references public.verticals (id),
  add column shift text not null default '' check (char_length(shift) <= 40),
  add column priority int check (priority is null or priority between 1 and 10),
  add column email text not null default '' check (char_length(email) <= 254),
  add column roll_number text not null default '' check (char_length(roll_number) <= 60),
  add column linkedin_url text not null default '' check (char_length(linkedin_url) <= 500),
  add column github_url text not null default '' check (char_length(github_url) <= 500),
  add column team_message text not null default '' check (char_length(team_message) <= 4000),
  add column remarks text not null default '' check (char_length(remarks) <= 4000),
  -- one or more submitted-task links: [{"label":"Task 1","url":"https://..."}]
  add column task_links jsonb not null default '[]'::jsonb,
  -- any other profiles: [{"label":"Instagram","url":"..."}]
  add column external_profiles jsonb not null default '[]'::jsonb,
  -- every column from the source row that we do not model above
  add column source_extra jsonb not null default '{}'::jsonb,
  -- spreadsheet provenance for stable identity across repeated imports
  add column source_key text,
  add column source_sheet text,
  add column source_row int,
  add column source_updated_at timestamptz,
  add column imported_at timestamptz,
  add column last_synced_at timestamptz;

-- Stable identity: (source_sheet, source_key) or application_id/roll_number.
create unique index candidates_source_uidx
  on public.candidates (source_sheet, source_key)
  where source_sheet is not null and source_key is not null;
create index candidates_roll_idx on public.candidates (roll_number)
  where roll_number <> '';
create index candidates_vertical_idx on public.candidates (vertical_id);
create index candidates_priority_idx on public.candidates (priority);

-- ---------------------------------------------------------------------------
-- criteria: the five default criteria live on 1–5 stars (editable).
-- criterion_scores gains optional per-criterion written feedback.
-- ---------------------------------------------------------------------------
alter table public.criterion_scores
  add column feedback text not null default '' check (char_length(feedback) <= 2000);

-- ---------------------------------------------------------------------------
-- spreadsheet_connections: one configured source workbook per deployment.
-- Credentials stay server-side; nothing here is readable by non-admins.
-- ---------------------------------------------------------------------------
create table public.spreadsheet_connections (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('google_sheets', 'excel_upload')),
  -- Google Sheet id (https://docs.google.com/spreadsheets/d/<sheet_id>/...)
  spreadsheet_id text not null default '',
  title text not null default '',
  -- logical name of the tab per vertical is stored on verticals.worksheet;
  -- this stores the header-row convention we expect
  header_row int not null default 1,
  is_active boolean not null default true,
  last_sync_at timestamptz,
  last_sync_status text not null default 'never'
    check (last_sync_status in ('never', 'ok', 'error')),
  last_sync_error text not null default '',
  -- optimistic-concurrency token observed last time we read the sheet
  sheet_revision text not null default '',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- spreadsheet_sync_queue: durable two-way sync outbox with retries.
-- A failed spreadsheet update NEVER touches or erases committed evaluations;
-- it just sits here with attempts/last_error until retried.
-- ---------------------------------------------------------------------------
create table public.spreadsheet_sync_queue (
  id uuid primary key default gen_random_uuid(),
  direction text not null check (direction in ('to_sheet', 'from_sheet')),
  entity_type text not null check (entity_type in ('applicant', 'evaluation')),
  entity_id uuid not null,
  -- which worksheet/vertical this row belongs to
  worksheet text not null default '',
  -- stable row matcher (never the applicant's name alone)
  row_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'in_flight', 'done', 'failed', 'conflict')),
  attempts int not null default 0 check (attempts >= 0),
  last_error text not null default '',
  -- conflict evidence: what the sheet had when we collided
  conflict jsonb,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index spreadsheet_sync_queue_status_idx
  on public.spreadsheet_sync_queue (status, created_at);
create index spreadsheet_sync_queue_entity_idx
  on public.spreadsheet_sync_queue (entity_type, entity_id);

-- one queued mutation per entity+direction; requeueing overwrites the payload
create unique index spreadsheet_sync_queue_uidx
  on public.spreadsheet_sync_queue (direction, entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- spreadsheet_sync_log: audit trail of completed sync operations
-- ---------------------------------------------------------------------------
create table public.spreadsheet_sync_log (
  id bigint generated always as identity primary key,
  connection_id uuid references public.spreadsheet_connections (id),
  direction text not null,
  operation text not null,
  row_key text not null default '',
  status text not null check (status in ('ok', 'error', 'conflict')),
  detail text not null default '',
  actor_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index spreadsheet_sync_log_created_idx on public.spreadsheet_sync_log (created_at);

-- ---------------------------------------------------------------------------
-- RLS: no client access to sync tables (backend service role only);
-- verticals readable by every authenticated user.
-- ---------------------------------------------------------------------------
alter table public.verticals enable row level security;
alter table public.spreadsheet_connections enable row level security;
alter table public.spreadsheet_sync_queue enable row level security;
alter table public.spreadsheet_sync_log enable row level security;

create policy verticals_select on public.verticals
  for select using (auth.uid() is not null);
create policy verticals_write_admin on public.verticals
  for all using (public.is_admin()) with check (public.is_admin());

create policy spreadsheet_connections_admin on public.spreadsheet_connections
  for all using (public.is_admin()) with check (public.is_admin());
create policy spreadsheet_sync_queue_admin on public.spreadsheet_sync_queue
  for all using (public.is_admin()) with check (public.is_admin());
create policy spreadsheet_sync_log_admin on public.spreadsheet_sync_log
  for all using (public.is_admin()) with check (public.is_admin());

create trigger verticals_updated_at before update on public.verticals
  for each row execute function public.set_updated_at();
create trigger spreadsheet_connections_updated_at before update on public.spreadsheet_connections
  for each row execute function public.set_updated_at();
create trigger spreadsheet_sync_queue_updated_at before update on public.spreadsheet_sync_queue
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- candidate_results rebuilt with vertical/shift/priority + provisional flag.
-- "provisional" = some expected evaluations are still missing.
-- ---------------------------------------------------------------------------
drop view if exists public.candidate_results;
create view public.candidate_results as
select
  c.id as candidate_id,
  c.full_name,
  c.branch,
  c.application_id,
  c.roll_number,
  c.panel_id,
  p.name as panel_name,
  p.expected_evaluations,
  c.vertical_id,
  v.name as vertical_name,
  c.shift,
  c.priority,
  c.interview_status,
  c.shortlisting_status,
  c.archived_at,
  agg.evaluation_count,
  agg.average_score,
  case
    when agg.evaluation_count = 0 then 'not_started'
    when agg.evaluation_count < p.expected_evaluations then 'in_progress'
    else 'complete'
  end as evaluation_status,
  (agg.evaluation_count < p.expected_evaluations) as is_provisional,
  agg.judge_ratings
from public.candidates c
join public.panels p on p.id = c.panel_id
left join public.verticals v on v.id = c.vertical_id
left join lateral (
  select
    count(*)::int as evaluation_count,
    round(avg(e.overall_score), 2) as average_score,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'judge_id', e.judge_id,
          'judge_name', pr.full_name,
          'judge_login_id', pr.login_id,
          'score', e.overall_score,
          'evaluation_id', e.id,
          'submitted_at', e.submitted_at,
          'version', e.version
        ) order by e.submitted_at
      ) filter (where e.id is not null),
      '[]'::jsonb
    ) as judge_ratings
  from public.evaluations e
  join public.profiles pr on pr.id = e.judge_id
  where e.candidate_id = c.id and e.status = 'submitted'
) agg on true;

grant select on public.candidate_results to authenticated;

-- ---------------------------------------------------------------------------
-- The five default evaluation criteria for a round are inserted by the backend
-- when a round is created (names/descriptions editable afterwards). The
-- scale is 1–5; see backend/src/services/rubric.ts.
-- ---------------------------------------------------------------------------
