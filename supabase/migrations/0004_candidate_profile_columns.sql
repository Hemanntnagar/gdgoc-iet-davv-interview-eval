-- ---------------------------------------------------------------------------
-- Applicant profile columns on candidate_results.
-- The Google Sheets export needs the contact/profile fields that the list
-- view omitted. New columns are appended so CREATE OR REPLACE VIEW stays
-- compatible with the existing column order.
-- ---------------------------------------------------------------------------
create or replace view public.candidate_results as
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
  agg.judge_ratings,
  c.email,
  c.linkedin_url,
  c.github_url,
  c.team_message,
  c.remarks
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
