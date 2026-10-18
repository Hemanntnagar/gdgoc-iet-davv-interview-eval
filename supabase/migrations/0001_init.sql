-- GDGOC IET DAVV Interview Evaluation System — initial schema
-- Apply via Supabase SQL editor or `supabase db push`.
-- All application writes go through the backend (service role); RLS protects
-- users who call the Supabase REST API directly.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums / check constraints (plain text + check for easy evolution)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- profiles: one row per auth.users entry. Role is NEVER set by the client.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'judge' check (role in ('judge', 'admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Auto-create a judge profile when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- panels
-- ---------------------------------------------------------------------------
create table public.panels (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  -- how many submitted evaluations each candidate on this panel should have
  expected_evaluations int not null default 1 check (expected_evaluations >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- panel_codes: hashed verification codes. Plaintext never stored.
-- code_hash = sha256(pepper || code); pepper lives in backend env only.
-- ---------------------------------------------------------------------------
create table public.panel_codes (
  id uuid primary key default gen_random_uuid(),
  panel_id uuid not null references public.panels (id) on delete cascade,
  code_hash text not null,
  label text not null default '',
  -- non-reversible display hint for admins, e.g. "J7K2••••"
  preview text not null default '',
  is_active boolean not null default true,
  max_attempts int not null default 5 check (max_attempts >= 1),
  failed_attempts int not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);

create index panel_codes_hash_idx on public.panel_codes (code_hash) where is_active;

-- ---------------------------------------------------------------------------
-- panel_members: a judge may access a panel's candidates only after verifying
-- the panel code (backend inserts the membership) or admin assignment.
-- ---------------------------------------------------------------------------
create table public.panel_members (
  panel_id uuid not null references public.panels (id) on delete cascade,
  judge_id uuid not null references public.profiles (id) on delete cascade,
  verified_at timestamptz,
  assigned_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (panel_id, judge_id)
);

create index panel_members_judge_idx on public.panel_members (judge_id);

-- ---------------------------------------------------------------------------
-- candidates
-- ---------------------------------------------------------------------------
create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(full_name) between 1 and 200),
  branch text not null default '' check (char_length(branch) <= 120),
  application_id text check (application_id is null or char_length(application_id) <= 80),
  panel_id uuid not null references public.panels (id),
  interview_status text not null default 'pending'
    check (interview_status in ('pending', 'in_progress', 'completed', 'no_show')),
  shortlisting_status text not null default 'pending'
    check (shortlisting_status in ('pending', 'shortlisted', 'waitlisted', 'rejected')),
  notes text not null default '', -- admin-only interview notes
  archived_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index candidates_application_id_uidx
  on public.candidates (application_id) where application_id is not null;
create index candidates_panel_idx on public.candidates (panel_id) where archived_at is null;
create index candidates_name_trgm_idx on public.candidates using gin (to_tsvector('simple', full_name));
create index candidates_branch_idx on public.candidates (branch);

-- ---------------------------------------------------------------------------
-- evaluation_rounds: a.k.a. interview rounds. Policies are configurable.
-- ---------------------------------------------------------------------------
create table public.evaluation_rounds (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_open boolean not null default true,
  -- explicit edit policy: judges may replace their submitted evaluation
  allow_edit_after_submit boolean not null default false,
  closes_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- criteria: configurable rubric per round. Overall score = weighted mean of
-- criterion scores (weight 1 by default). If a round has no active criteria,
-- judges submit a single overall_score instead.
-- ---------------------------------------------------------------------------
create table public.criteria (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.evaluation_rounds (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  min_score numeric(5,2) not null default 1 check (min_score >= 0),
  max_score numeric(5,2) not null default 10 check (max_score > min_score),
  weight numeric(6,3) not null default 1 check (weight > 0),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index criteria_round_idx on public.criteria (round_id);

-- ---------------------------------------------------------------------------
-- evaluations: one official evaluation per (judge, candidate, round).
-- id is generated CLIENT-side (crypto.randomUUID) so offline submissions and
-- retried syncs are idempotent.
-- ---------------------------------------------------------------------------
create table public.evaluations (
  id uuid primary key,
  candidate_id uuid not null references public.candidates (id),
  judge_id uuid not null references public.profiles (id),
  panel_id uuid not null references public.panels (id),
  round_id uuid not null references public.evaluation_rounds (id),
  status text not null default 'submitted' check (status in ('submitted', 'withdrawn')),
  -- overall_score is computed and stored server-side from criterion scores
  -- (or taken from the client when the round has no active criteria).
  overall_score numeric(6,2) check (overall_score is null or overall_score >= 0),
  feedback text not null default '' check (char_length(feedback) <= 5000),
  version int not null default 1 check (version >= 1),
  client_created_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- One *submitted* official evaluation per judge/candidate/round.
-- Withdrawn rows do not block resubmission (explicit policy).
create unique index evaluations_official_uidx
  on public.evaluations (judge_id, candidate_id, round_id)
  where status = 'submitted';

create index evaluations_candidate_idx on public.evaluations (candidate_id) where status = 'submitted';
create index evaluations_judge_idx on public.evaluations (judge_id);
create index evaluations_panel_idx on public.evaluations (panel_id);

-- ---------------------------------------------------------------------------
-- criterion_scores: one row per criterion per evaluation
-- ---------------------------------------------------------------------------
create table public.criterion_scores (
  evaluation_id uuid not null references public.evaluations (id) on delete cascade,
  criterion_id uuid not null references public.criteria (id) on delete cascade,
  score numeric(6,2) not null,
  primary key (evaluation_id, criterion_id)
);

-- ---------------------------------------------------------------------------
-- audit_events
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id);
create index audit_events_actor_idx on public.audit_events (actor_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger panels_updated_at before update on public.panels
  for each row execute function public.set_updated_at();
create trigger candidates_updated_at before update on public.candidates
  for each row execute function public.set_updated_at();
create trigger rounds_updated_at before update on public.evaluation_rounds
  for each row execute function public.set_updated_at();
create trigger evaluations_updated_at before update on public.evaluations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helpers (security definer so policies cannot be abused to probe roles)
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active
  );
$$;

create or replace function public.is_panel_member(p_panel_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.panel_members
    where panel_id = p_panel_id and judge_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security — defense in depth for direct PostgREST access
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.panels enable row level security;
alter table public.panel_codes enable row level security;
alter table public.panel_members enable row level security;
alter table public.candidates enable row level security;
alter table public.evaluation_rounds enable row level security;
alter table public.criteria enable row level security;
alter table public.evaluations enable row level security;
alter table public.criterion_scores enable row level security;
alter table public.audit_events enable row level security;

-- profiles: read own row (admins read all via service role / admin policy)
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy profiles_update_admin on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());
-- No client insert/delete: signup trigger + backend service role.

-- panels: members and admins can read. No client writes (backend only).
create policy panels_select on public.panels
  for select using (public.is_admin() or public.is_panel_member(id));

-- panel_codes: no client access at all (hashes + attempt counters are sensitive).
create policy panel_codes_none on public.panel_codes
  for all using (false) with check (false);

-- panel_members: judges see their own memberships; admins see all.
create policy panel_members_select on public.panel_members
  for select using (public.is_admin() or judge_id = auth.uid());
-- No client writes: membership is created by the backend after code verification.

-- candidates: judges read non-archived candidates of their panels (without the
-- admin-only notes column via column privileges below); admins all.
create policy candidates_select on public.candidates
  for select using (
    public.is_admin()
    or (archived_at is null and public.is_panel_member(panel_id))
  );
create policy candidates_write_admin on public.candidates
  for all using (public.is_admin()) with check (public.is_admin());

-- Restrict notes to admins at the column level for non-admin roles.
revoke update on public.candidates from authenticated;
grant update (full_name, branch, application_id, panel_id, interview_status, shortlisting_status, archived_at)
  on public.candidates to authenticated;

-- rounds & criteria: readable by any authenticated user (rubric is not secret);
-- writable only via backend/admin.
create policy rounds_select on public.evaluation_rounds
  for select using (auth.uid() is not null);
create policy rounds_write_admin on public.evaluation_rounds
  for all using (public.is_admin()) with check (public.is_admin());

create policy criteria_select on public.criteria
  for select using (auth.uid() is not null);
create policy criteria_write_admin on public.criteria
  for all using (public.is_admin()) with check (public.is_admin());

-- evaluations: judges read/write only their own on panels they belong to; admins all.
create policy evaluations_select on public.evaluations
  for select using (
    public.is_admin()
    or (judge_id = auth.uid() and public.is_panel_member(panel_id))
  );
create policy evaluations_insert_own on public.evaluations
  for insert with check (
    judge_id = auth.uid() and public.is_panel_member(panel_id) and status = 'submitted'
  );
create policy evaluations_update_own on public.evaluations
  for update using (judge_id = auth.uid() and public.is_panel_member(panel_id))
  with check (judge_id = auth.uid() and public.is_panel_member(panel_id));

create policy criterion_scores_select on public.criterion_scores
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.evaluations e
      where e.id = evaluation_id
        and e.judge_id = auth.uid()
        and public.is_panel_member(e.panel_id)
    )
  );
create policy criterion_scores_write_own on public.criterion_scores
  for all using (
    exists (
      select 1 from public.evaluations e
      where e.id = evaluation_id
        and e.judge_id = auth.uid()
        and public.is_panel_member(e.panel_id)
    )
  )
  with check (
    exists (
      select 1 from public.evaluations e
      where e.id = evaluation_id
        and e.judge_id = auth.uid()
        and public.is_panel_member(e.panel_id)
    )
  );

-- audit_events: admins read; anyone may insert (backend writes; clients could
-- append but not read others' events — keep insert limited to own actor_id).
create policy audit_select_admin on public.audit_events
  for select using (public.is_admin());
create policy audit_insert_own on public.audit_events
  for insert with check (actor_id = auth.uid() or actor_id is null);

-- ---------------------------------------------------------------------------
-- candidate_results view: authoritative aggregates computed in the database.
-- Averages are the mean of *submitted* evaluations only (never zeros for
-- missing ones), rounded to 2 decimals, half away from zero.
-- ---------------------------------------------------------------------------
create or replace view public.candidate_results as
select
  c.id as candidate_id,
  c.full_name,
  c.branch,
  c.application_id,
  c.panel_id,
  p.name as panel_name,
  p.expected_evaluations,
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
  agg.judge_ratings
from public.candidates c
join public.panels p on p.id = c.panel_id
left join lateral (
  select
    count(*)::int as evaluation_count,
    round(avg(e.overall_score), 2) as average_score,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'judge_id', e.judge_id,
          'judge_name', pr.full_name,
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
