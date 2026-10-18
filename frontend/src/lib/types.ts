export type Role = 'judge' | 'admin';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
}

export interface Panel {
  id: string;
  name: string;
  is_active: boolean;
  expected_evaluations: number;
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
  panel_id: string;
  panel_name: string;
  expected_evaluations: number;
  interview_status: string;
  shortlisting_status: string;
  evaluation_status: 'not_started' | 'in_progress' | 'complete';
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
  scores: { criterion_id: string; score: number }[];
  judge_name?: string;
  candidate_name?: string;
  round_name?: string;
}
