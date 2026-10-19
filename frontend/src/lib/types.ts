export type Role = 'judge' | 'admin';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  // addendum: interviewer provisioning metadata
  login_id?: string;
  display_name?: string;
  vertical_ids?: string[];
  panel_ids?: string[];
  shift_restrictions?: string[];
  is_active?: boolean;
  created_at?: string;
  password_reset_at?: string | null;
}

export interface Panel {
  id: string;
  name: string;
  is_active: boolean;
  expected_evaluations: number;
  vertical_id?: string | null;
  shift?: string | null;
  panel_number?: number | null;
  description?: string | null;
}

export interface Vertical {
  id: string;
  key: string;
  name: string;
  worksheet: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface TaskLink {
  label: string;
  url: string;
}

export interface PanelMember {
  judge_id: string;
  judge_name: string;
  verified_at: string | null;
}

export interface Candidate {
  id: string;
  full_name: string;
  branch: string;
  application_id: string | null;
  panel_id: string;
  interview_status: 'pending' | 'in_progress' | 'completed' | 'no_show';
  shortlisting_status: 'pending' | 'shortlisted' | 'waitlisted' | 'rejected';
  archived_at: string | null;
  notes?: string;
  // addendum: expanded applicant profile
  vertical_id?: string | null;
  shift?: string | null;
  priority?: number | null;
  email?: string | null;
  roll_number?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  team_message?: string | null;
  remarks?: string | null;
  task_links?: TaskLink[];
  external_profiles?: TaskLink[];
  source_extra?: Record<string, unknown> | null;
  source_sheet?: string | null;
  source_row?: number | null;
  imported_at?: string | null;
  last_synced_at?: string | null;
}

export interface Round {
  id: string;
  name: string;
  is_open: boolean;
  allow_edit_after_submit: boolean;
  closes_at: string | null;
}

export interface Criterion {
  id: string;
  round_id: string;
  name: string;
  description: string;
  min_score: number;
  max_score: number;
  weight: number;
  sort_order: number;
  is_active: boolean;
}

export interface OutboxItem {
  /** Client-generated UUID — idempotency key for the sync API. */
  id: string;
  candidate_id: string;
  candidate_name: string;
  round_id: string;
  round_name: string;
  panel_id: string;
  feedback: string;
  overall_score: number | null;
  scores: Record<string, number>;
  /** addendum: per-criterion written feedback */
  criterion_feedbacks?: Record<string, string>;
  client_created_at: string;
  status: 'pending' | 'syncing' | 'synced' | 'conflict' | 'error';
  last_error?: string;
  attempts: number;
  last_attempt_at?: string;
  conflict?: { message: string; server?: unknown };
}

export interface SyncResultRow {
  id: string;
  status: 'ok' | 'duplicate' | 'conflict' | 'error';
  idempotent?: boolean;
  message?: string;
  details?: Record<string, string>;
  evaluation?: unknown;
  existing?: unknown;
}

export interface JudgeRating {
  judge_id: string;
  judge_name: string;
  score: number | null;
  evaluation_id: string;
  submitted_at: string;
  version: number;
}

export interface ResultRow {
  candidate_id: string;
  full_name: string;
  branch: string;
  application_id: string | null;
  roll_number?: string;
  panel_id: string;
  panel_name: string;
  expected_evaluations: number;
  vertical_id?: string | null;
  vertical_name?: string | null;
  shift?: string;
  priority?: number | null;
  interview_status: string;
  shortlisting_status: string;
  evaluation_status: 'not_started' | 'in_progress' | 'complete';
  is_provisional?: boolean;
  evaluation_count: number;
  average_score: number | null;
  judge_ratings: JudgeRating[];
}

export interface EvaluationWithScores {
  id: string;
  candidate_id: string;
  judge_id: string;
  round_id: string;
  overall_score: number | null;
  feedback: string;
  version: number;
  status: string;
  submitted_at: string;
  scores: { criterion_id: string; score: number; feedback?: string }[];
  judge_name?: string;
  candidate_name?: string;
  round_name?: string;
}

/** addendum: admin-provisioned interviewer account. */
export interface Interviewer {
  id: string;
  email: string;
  login_id: string;
  display_name: string;
  vertical_ids: string[];
  panel_ids: string[];
  shift_restrictions: string[];
  is_active: boolean;
  created_at: string;
  password_reset_at: string | null;
}

/** One-time credentials — only ever returned by provision/reset endpoints. */
export interface ProvisionCredentials {
  login_id: string;
  email: string;
  password: string;
}

/** addendum: spreadsheet sync connection status. */
export interface SheetConnectionStatus {
  configured: boolean;
  has_credentials: boolean;
  spreadsheet_id: string;
  url: string;
  connection: {
    id: string;
    spreadsheet_id: string;
    title: string;
    header_row: number;
    is_active: boolean;
    last_sync_at: string | null;
    last_sync_status: string;
    last_sync_error: string;
  } | null;
  reachable: boolean;
}
