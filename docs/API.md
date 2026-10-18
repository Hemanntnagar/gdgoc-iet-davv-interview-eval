# API contract (v1)

Base URL: `https://<backend>/api`. All endpoints except `/health` require
`Authorization: Bearer <Supabase access token>`. Roles come from the database,
never from the request. Errors: `{ "error": { "code", "message", "details?" } }`.

| Method | Path | Role | Purpose |
|---|---|---|---|
| GET | `/health` | public | Liveness |
| GET | `/me` | any | Profile + my panels |
| POST | `/panels/verify` | judge | Verify code `{code}` → grants panel membership |
| GET | `/panels/mine` | judge | Panels I belong to |
| GET | `/panels` | admin | All panels + members |
| POST | `/panels` | admin | Create panel `{name, expected_evaluations}` |
| PATCH | `/panels/:id` | admin | Update name/active/expected |
| GET | `/panels/:id/codes` | admin | Code metadata (never plaintext/hash) |
| POST | `/panels/:id/codes` | admin | Create code → returns plaintext once |
| POST | `/panels/:id/codes/rotate` | admin | Revoke all active, issue new |
| PATCH | `/panel-codes/:codeId` | admin | `{is_active}` |
| GET/POST/DELETE | `/panels/:id/members[/:judgeId]` | admin | Assign/remove judges |
| GET | `/candidates` | any | Filters: `search,branch,panelId,interviewStatus,shortlistingStatus,evaluationStatus,sort,order,includeArchived` |
| GET | `/candidates/:id` | any | Scoped; `notes` only for admins |
| POST | `/candidates` | admin | Create |
| PATCH | `/candidates/:id` | admin | Update |
| POST | `/candidates/:id/archive` | admin | `{archived}` |
| POST | `/candidates/import` | admin | `{csv}` → `{imported, skipped_duplicates, errors[]}` |
| GET | `/candidates/import/template.csv` | admin | Import template |
| GET | `/rounds` | any | Rounds |
| GET | `/rounds/:id/criteria` | any | Rubric |
| POST | `/rounds`, PATCH `/rounds/:id` | admin | Manage rounds (open/edit policy) |
| POST | `/rounds/:id/criteria`, PATCH `/criteria/:id` | admin | Manage rubric |
| POST | `/evaluations` | judge | Submit; body `{id (client UUID), candidate_id, round_id, scores{}, overall_score?, feedback, replace_existing?}` → 201 ok / 200 idempotent / 409 duplicate |
| PATCH | `/evaluations/:id` | judge (own) | Only when round allows edits |
| GET | `/evaluations/mine` | judge | Own history |
| GET | `/evaluations?candidateId=` | any | Scoped ratings for a candidate |
| GET | `/sync/status` | any | Connectivity/auth probe |
| POST | `/sync/evaluations` | judge | Batch idempotent sync → `{results: [{id, status: ok\|conflict\|error, ...}]}` |
| GET | `/results` | any | Aggregate table (scoped); averages from DB view |
| GET | `/export/summary.csv` | admin | Averages + counts |
| GET | `/export/detailed.csv` | admin | Per-judge ratings + feedback + criterion scores |
| GET | `/admin/users` | admin | Accounts + panel assignments |
| PATCH | `/admin/users/:id/role` | admin | Change role (last-admin guard) |
| PATCH | `/admin/users/:id/active` | admin | Activate/deactivate |

## Averaging rules (authoritative, computed in PostgreSQL)

- Overall score per evaluation = weighted mean of criterion scores (round rubric),
  or the judge's single 1–10 score when the round has no active criteria.
  Rounded to 2 decimals, half away from zero.
- Candidate average = mean of **submitted** evaluations' overall scores only.
  Missing evaluations are never treated as zero; `evaluation_status` distinguishes
  `not_started` / `in_progress` / `complete` against the panel's
  `expected_evaluations`.
- Recalculation is automatic because averages are computed by the
  `candidate_results` view at read time.
