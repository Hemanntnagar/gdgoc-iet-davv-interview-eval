export type Role = 'judge' | 'admin';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface Panel {
  id: string;
  name: string;
  is_active: boolean;
  expected_evaluations: number;
  created_at: string;
}

export interface PanelCodeMeta {
  id: string;
  panel_id: string;
  label: string;
  is_active: boolean;
  max_attempts: number;
  failed_attempts: number;
  locked_until: string | null;
  expires_at: string | null;
  created_at: string;
  rotated_at: string | null;
  code_preview: string; // short non-reversible display hint, e.g. "••••ABCD"
}

export interface Candidate {
  id: string;
  full_name: string;
  branch: string;
  application_id: string | null;
  panel_id: string;
  interview_status: 'pending' | 'in_progress' | 'completed' | 'no_show';
  shortlisting_status: 'pending' | 'shortlisted' | 'waitlisted' | 'rejected';
  notes: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
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

export interface CriterionScore {
  criterion_id: string;
  score: number;
}

export interface Evaluation {
  id: string;
  candidate_id: string;
  judge_id: string;
  panel_id: string;
  round_id: string;
  status: 'submitted' | 'withdrawn';
  overall_score: number | null;
  feedback: string;
  version: number;
  client_created_at: string | null;
  submitted_at: string;
  updated_at: string;
}

export interface EvaluationWithScores extends Evaluation {
  scores: CriterionScore[];
  judge_name?: string;
  candidate_name?: string;
  round_name?: string;
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
  archived_at: string | null;
}

export interface CandidateFilters {
  search?: string;
  branch?: string;
  panelId?: string;
  interviewStatus?: string;
  shortlistingStatus?: string;
  evaluationStatus?: string;
  sort?: 'name' | 'branch' | 'average' | 'created';
  order?: 'asc' | 'desc';
  includeArchived?: boolean;
}

export interface CandidateScope {
  admin: boolean;
  judgeId?: string;
  panelIds?: string[];
}

export interface SubmitEvaluationInput {
  id: string; // client-generated UUID — idempotency key
  candidate_id: string;
  round_id: string;
  feedback: string;
  overall_score?: number | null; // used when round has no active criteria
  scores: Record<string, number>; // criterion_id -> score
  client_created_at?: string | null;
}

export type SubmitOutcome =
  | { status: 'ok'; evaluation: EvaluationWithScores; idempotent?: boolean }
  | { status: 'duplicate'; existing: Evaluation }
  | { status: 'conflict'; reason: string; server?: Evaluation }
  | { status: 'error'; message: string; details?: Record<string, string> };

export interface ImportRowResult {
  row: number;
  message: string;
}

export interface ImportResult {
  imported: number;
  skipped_duplicates: number;
  errors: ImportRowResult[];
}

export type VerifyOutcome =
  | { status: 'ok'; panel: Panel }
  | { status: 'invalid' }
  | { status: 'locked'; retry_at: string }
  | { status: 'panel_inactive' };

export interface AuditEntry {
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
}

/**
 * Persistence boundary. SupabaseStore is used in production; MemoryStore powers
 * automated tests with identical semantics (constraints included).
 */
export interface Store {
  getProfile(id: string): Promise<Profile | null>;
  getProfilesByIds(ids: string[]): Promise<Profile[]>;
  listProfiles(role?: Role): Promise<Profile[]>;
  createProfile(input: { id: string; email: string; full_name: string; role: Role }): Promise<Profile>;
  setProfileRole(userId: string, role: Role): Promise<Profile | null>;
  setProfileActive(userId: string, isActive: boolean): Promise<Profile | null>;

  listPanels(): Promise<Panel[]>;
  getPanel(id: string): Promise<Panel | null>;
  createPanel(input: { name: string; expected_evaluations: number }): Promise<Panel>;
  updatePanel(
    id: string,
    patch: { name?: string; is_active?: boolean; expected_evaluations?: number },
  ): Promise<Panel | null>;
  listMyPanels(judgeId: string): Promise<Panel[]>;

  createPanelCode(input: {
    panel_id: string;
    code_hash: string;
    label: string;
    preview: string;
    expires_at?: string | null;
  }): Promise<PanelCodeMeta>;
  rotatePanelCode(input: {
    panel_id: string;
    code_hash: string;
    label: string;
    preview: string;
    expires_at?: string | null;
  }): Promise<PanelCodeMeta>; // deactivates previous active codes, inserts new
  setPanelCodeActive(codeId: string, isActive: boolean): Promise<PanelCodeMeta | null>;
  listPanelCodes(panelId: string): Promise<PanelCodeMeta[]>;

  /** Validates a hashed code, handles attempt counting/locking, creates membership. */
  verifyPanelCode(input: { code_hash: string; judge_id: string; lockout_minutes: number }): Promise<VerifyOutcome>;
  /** Increment a code's failure counter; lock it when attempts are exhausted. */
  recordFailedCodeAttempt(codeId: string, maxAttempts: number, lockoutMinutes: number): Promise<string | null>;
  addPanelMember(panelId: string, judgeId: string, assignedBy: string | null): Promise<void>;
  removePanelMember(panelId: string, judgeId: string): Promise<boolean>;
  listPanelMembers(panelId: string): Promise<{ judge_id: string; judge_name: string; verified_at: string | null }[]>;

  listCandidates(scope: CandidateScope, filters: CandidateFilters): Promise<Candidate[]>;
  getCandidate(id: string, scope: CandidateScope): Promise<Candidate | null>;
  createCandidate(
    input: { full_name: string; branch: string; application_id: string | null; panel_id: string },
    actorId: string,
  ): Promise<Candidate>;
  updateCandidate(
    id: string,
    patch: Partial<{
      full_name: string;
      branch: string;
      application_id: string | null;
      panel_id: string;
      interview_status: string;
      shortlisting_status: string;
      notes: string;
    }>,
  ): Promise<Candidate | null>;
  archiveCandidate(id: string, archived: boolean): Promise<Candidate | null>;
  bulkCreateCandidates(
    rows: { full_name: string; branch: string; application_id: string | null; panel_id: string }[],
    actorId: string,
  ): Promise<ImportResult>;

  listRounds(): Promise<Round[]>;
  getRound(id: string): Promise<Round | null>;
  createRound(input: { name: string; is_open: boolean; allow_edit_after_submit: boolean; closes_at: string | null }): Promise<Round>;
  updateRound(
    id: string,
    patch: Partial<{ name: string; is_open: boolean; allow_edit_after_submit: boolean; closes_at: string | null }>,
  ): Promise<Round | null>;

  listCriteria(roundId: string): Promise<Criterion[]>;
  createCriterion(input: Omit<Criterion, 'id' | 'created_at'>): Promise<Criterion>;
  updateCriterion(id: string, patch: Partial<Criterion>): Promise<Criterion | null>;

  getEvaluation(id: string): Promise<EvaluationWithScores | null>;
  getOfficialEvaluation(judgeId: string, candidateId: string, roundId: string): Promise<EvaluationWithScores | null>;
  listEvaluations(filter: {
    admin: boolean;
    judgeId?: string;
    candidateId?: string;
    panelIds?: string[];
  }): Promise<EvaluationWithScores[]>;

  /** Applies duplicate/idempotency rules; writes scores; returns outcome. */
  submitEvaluation(
    judgeId: string,
    input: SubmitEvaluationInput,
    computed: { overall_score: number | null; scores: CriterionScore[] },
    opts: { replaceExisting: boolean },
  ): Promise<SubmitOutcome>;

  updateEvaluation(
    id: string,
    judgeId: string,
    patch: { feedback: string; overall_score: number | null; scores: CriterionScore[] },
  ): Promise<SubmitOutcome>;

  results(scope: CandidateScope, filters: CandidateFilters): Promise<ResultRow[]>;

  audit(entry: AuditEntry): Promise<void>;
}
