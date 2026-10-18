import { randomUUID } from 'node:crypto';
import { meanOrNull, round2 } from '../lib/scoring.js';
import type {
  AuditEntry,
  Candidate,
  CandidateFilters,
  CandidateScope,
  Criterion,
  CriterionScore,
  Evaluation,
  EvaluationWithScores,
  ImportResult,
  Panel,
  PanelCodeMeta,
  Profile,
  ResultRow,
  Round,
  Role,
  Store,
  SubmitEvaluationInput,
  SubmitOutcome,
  VerifyOutcome,
} from './types.js';

/**
 * In-memory implementation of the Store contract with the same uniqueness and
 * policy semantics as the Supabase implementation. Used by automated tests.
 */
export class MemoryStore implements Store {
  profiles = new Map<string, Profile>();
  panels = new Map<string, Panel>();
  panelCodes = new Map<string, PanelCodeMeta & { code_hash: string }>();
  panelMembers: { panel_id: string; judge_id: string; verified_at: string | null }[] = [];
  candidates = new Map<string, Candidate>();
  rounds = new Map<string, Round>();
  criteria = new Map<string, Criterion>();
  evaluations = new Map<string, Evaluation>();
  criterionScores = new Map<string, CriterionScore[]>();
  audits: AuditEntry[] = [];

  private now() {
    return new Date().toISOString();
  }

  async getProfile(id: string): Promise<Profile | null> {
    return this.profiles.get(id) ?? null;
  }
  async getProfilesByIds(ids: string[]): Promise<Profile[]> {
    return ids.map((id) => this.profiles.get(id)).filter((p): p is Profile => !!p);
  }
  async listProfiles(role?: Role): Promise<Profile[]> {
    const all = [...this.profiles.values()].filter((p) => (role ? p.role === role : true));
    return all.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async createProfile(input: { id: string; email: string; full_name: string; role: Role }): Promise<Profile> {
    if (this.profiles.has(input.id)) throw new Error('Profile already exists');
    const p: Profile = { ...input, is_active: true, created_at: this.now() };
    this.profiles.set(p.id, p);
    return p;
  }
  async setProfileRole(userId: string, role: Role): Promise<Profile | null> {
    const p = this.profiles.get(userId);
    if (!p) return null;
    p.role = role;
    return p;
  }
  async setProfileActive(userId: string, isActive: boolean): Promise<Profile | null> {
    const p = this.profiles.get(userId);
    if (!p) return null;
    p.is_active = isActive;
    return p;
  }

  async listPanels(): Promise<Panel[]> {
    return [...this.panels.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  async getPanel(id: string): Promise<Panel | null> {
    return this.panels.get(id) ?? null;
  }
  async createPanel(input: { name: string; expected_evaluations: number }): Promise<Panel> {
    if ([...this.panels.values()].some((p) => p.name === input.name)) {
      throw new Error('Panel name already exists');
    }
    const p: Panel = { id: randomUUID(), created_at: this.now(), is_active: true, ...input };
    this.panels.set(p.id, p);
    return p;
  }
  async updatePanel(
    id: string,
    patch: { name?: string; is_active?: boolean; expected_evaluations?: number },
  ): Promise<Panel | null> {
    const p = this.panels.get(id);
    if (!p) return null;
    Object.assign(p, patch);
    return p;
  }
  async listMyPanels(judgeId: string): Promise<Panel[]> {
    const ids = this.panelMembers.filter((m) => m.judge_id === judgeId).map((m) => m.panel_id);
    return (await Promise.all(ids.map((id) => this.getPanel(id)))).filter((p): p is Panel => !!p);
  }

  async createPanelCode(input: {
    panel_id: string;
    code_hash: string;
    label: string;
    preview: string;
    expires_at?: string | null;
  }): Promise<PanelCodeMeta> {
    const row: PanelCodeMeta & { code_hash: string } = {
      id: randomUUID(),
      panel_id: input.panel_id,
      code_hash: input.code_hash,
      label: input.label,
      code_preview: input.preview,
      is_active: true,
      max_attempts: 5,
      failed_attempts: 0,
      locked_until: null,
      expires_at: input.expires_at ?? null,
      created_at: this.now(),
      rotated_at: null,
    };
    this.panelCodes.set(row.id, row);
    return this.toCodeMeta(row);
  }
  async rotatePanelCode(input: {
    panel_id: string;
    code_hash: string;
    label: string;
    preview: string;
    expires_at?: string | null;
  }): Promise<PanelCodeMeta> {
    for (const c of this.panelCodes.values()) {
      if (c.panel_id === input.panel_id && c.is_active) {
        c.is_active = false;
        c.rotated_at = this.now();
      }
    }
    return this.createPanelCode(input);
  }
  async setPanelCodeActive(codeId: string, isActive: boolean): Promise<PanelCodeMeta | null> {
    const c = this.panelCodes.get(codeId);
    if (!c) return null;
    c.is_active = isActive;
    if (!isActive) c.rotated_at = this.now();
    return this.toCodeMeta(c);
  }
  async listPanelCodes(panelId: string): Promise<PanelCodeMeta[]> {
    return [...this.panelCodes.values()]
      .filter((c) => c.panel_id === panelId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((c) => this.toCodeMeta(c));
  }
  private toCodeMeta(c: PanelCodeMeta & { code_hash: string }): PanelCodeMeta {
    const { code_hash: _h, ...meta } = c;
    return { ...meta };
  }

  /** Increment a code's failure counter; lock it when attempts are exhausted. */
  async recordFailedCodeAttempt(codeId: string, maxAttempts: number, lockoutMinutes: number): Promise<string | null> {
    const c = this.panelCodes.get(codeId);
    if (!c) return null;
    c.failed_attempts += 1;
    if (c.failed_attempts >= maxAttempts) {
      c.locked_until = new Date(Date.now() + lockoutMinutes * 60_000).toISOString();
    }
    return c.locked_until;
  }

  async addPanelMember(panelId: string, judgeId: string, assignedBy: string | null): Promise<void> {
    if (!this.panelMembers.some((m) => m.panel_id === panelId && m.judge_id === judgeId)) {
      this.panelMembers.push({ panel_id: panelId, judge_id: judgeId, verified_at: null });
    }
    void assignedBy;
  }
  async removePanelMember(panelId: string, judgeId: string): Promise<boolean> {
    const before = this.panelMembers.length;
    this.panelMembers = this.panelMembers.filter(
      (m) => !(m.panel_id === panelId && m.judge_id === judgeId),
    );
    return this.panelMembers.length < before;
  }
  async listPanelMembers(panelId: string): Promise<{ judge_id: string; judge_name: string; verified_at: string | null }[]> {
    return this.panelMembers
      .filter((m) => m.panel_id === panelId)
      .map((m) => ({
        judge_id: m.judge_id,
        judge_name: this.profiles.get(m.judge_id)?.full_name ?? '',
        verified_at: m.verified_at,
      }));
  }

  async verifyPanelCode(input: {
    code_hash: string;
    judge_id: string;
    lockout_minutes: number;
  }): Promise<VerifyOutcome> {
    const active = [...this.panelCodes.values()].filter((c) => c.is_active);
    const matches = active.filter((c) => c.code_hash === input.code_hash);
    const now = Date.now();
    if (matches.length === 0) return { status: 'invalid' };
    const live = matches.filter((c) => !c.expires_at || new Date(c.expires_at).getTime() > now);
    if (live.length === 0) {
      // Hash matched but every matching code is expired — count the failed attempt.
      for (const c of matches) await this.recordFailedCodeAttempt(c.id, c.max_attempts, input.lockout_minutes);
      return { status: 'invalid' };
    }
    const candidateCode = live[0];
    if (candidateCode.locked_until && new Date(candidateCode.locked_until).getTime() > now) {
      return { status: 'locked', retry_at: candidateCode.locked_until };
    }
    const panel = this.panels.get(candidateCode.panel_id);
    if (!panel) return { status: 'invalid' };
    if (!panel.is_active) {
      const lockedUntil = await this.recordFailedCodeAttempt(
        candidateCode.id,
        candidateCode.max_attempts,
        input.lockout_minutes,
      );
      if (lockedUntil) return { status: 'locked', retry_at: lockedUntil };
      return { status: 'panel_inactive' };
    }
    candidateCode.failed_attempts = 0;
    candidateCode.locked_until = null;
    if (!this.panelMembers.some((m) => m.panel_id === panel.id && m.judge_id === input.judge_id)) {
      this.panelMembers.push({
        panel_id: panel.id,
        judge_id: input.judge_id,
        verified_at: this.now(),
      });
    }
    return { status: 'ok', panel };
  }

  async listCandidates(scope: CandidateScope, filters: CandidateFilters): Promise<Candidate[]> {
    let rows = [...this.candidates.values()].filter((c) => {
      if (!scope.admin && !(scope.panelIds ?? []).includes(c.panel_id)) return false;
      if (!filters.includeArchived && c.archived_at) return false;
      if (filters.panelId && c.panel_id !== filters.panelId) return false;
      if (filters.branch && !c.branch.toLowerCase().includes(filters.branch.toLowerCase())) return false;
      if (filters.interviewStatus && c.interview_status !== filters.interviewStatus) return false;
      if (filters.shortlistingStatus && c.shortlisting_status !== filters.shortlistingStatus) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hay = `${c.full_name} ${c.application_id ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (filters.evaluationStatus) {
      const results = await this.results(scope, { includeArchived: true });
      const byId = new Map(results.map((r) => [r.candidate_id, r.evaluation_status]));
      rows = rows.filter((c) => byId.get(c.id) === filters.evaluationStatus);
    }
    const order = filters.order === 'desc' ? -1 : 1;
    const averages = new Map<string, number | null>();
    if (filters.sort === 'average') {
      const results = await this.results(scope, { includeArchived: true });
      for (const r of results) averages.set(r.candidate_id, r.average_score);
    }
    rows.sort((a, b) => {
      let cmp = 0;
      switch (filters.sort) {
        case 'branch':
          cmp = a.branch.localeCompare(b.branch);
          break;
        case 'average': {
          const av = averages.get(a.id) ?? -1;
          const bv = averages.get(b.id) ?? -1;
          cmp = av - bv;
          break;
        }
        case 'created':
          cmp = a.created_at.localeCompare(b.created_at);
          break;
        default:
          cmp = a.full_name.localeCompare(b.full_name);
      }
      if (cmp === 0) cmp = a.full_name.localeCompare(b.full_name);
      return cmp * order;
    });
    return rows.map((c) => (scope.admin ? c : { ...c, notes: '' }));
  }
  async getCandidate(id: string, scope: CandidateScope): Promise<Candidate | null> {
    const c = this.candidates.get(id);
    if (!c) return null;
    if (!scope.admin && !(scope.panelIds ?? []).includes(c.panel_id)) return null;
    return scope.admin ? c : { ...c, notes: '' };
  }
  async createCandidate(
    input: { full_name: string; branch: string; application_id: string | null; panel_id: string },
    actorId: string,
  ): Promise<Candidate> {
    if (input.application_id && [...this.candidates.values()].some((c) => c.application_id === input.application_id)) {
      throw new Error('application_id already exists');
    }
    const c: Candidate = {
      id: randomUUID(),
      interview_status: 'pending',
      shortlisting_status: 'pending',
      notes: '',
      archived_at: null,
      created_at: this.now(),
      updated_at: this.now(),
      ...input,
      application_id: input.application_id || null,
    };
    void actorId;
    this.candidates.set(c.id, c);
    return c;
  }
  async updateCandidate(
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
  ): Promise<Candidate | null> {
    const c = this.candidates.get(id);
    if (!c) return null;
    Object.assign(c, patch, { updated_at: this.now() });
    return c;
  }
  async archiveCandidate(id: string, archived: boolean): Promise<Candidate | null> {
    const c = this.candidates.get(id);
    if (!c) return null;
    c.archived_at = archived ? this.now() : null;
    c.updated_at = this.now();
    return c;
  }
  async bulkCreateCandidates(
    rows: { full_name: string; branch: string; application_id: string | null; panel_id: string }[],
    _actorId: string,
  ): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, skipped_duplicates: 0, errors: [] };
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row.full_name) {
        result.errors.push({ row: i + 2, message: 'full_name is required' });
        continue;
      }
      if (!this.panels.has(row.panel_id)) {
        result.errors.push({ row: i + 2, message: 'Panel not found' });
        continue;
      }
      if (row.application_id) {
        if (
          seen.has(row.application_id) ||
          [...this.candidates.values()].some((c) => c.application_id === row.application_id)
        ) {
          result.skipped_duplicates += 1;
          continue;
        }
        seen.add(row.application_id);
      }
      await this.createCandidate(row, _actorId);
      result.imported += 1;
    }
    return result;
  }

  async listRounds(): Promise<Round[]> {
    return [...this.rounds.values()];
  }
  async getRound(id: string): Promise<Round | null> {
    return this.rounds.get(id) ?? null;
  }
  async createRound(input: {
    name: string;
    is_open: boolean;
    allow_edit_after_submit: boolean;
    closes_at: string | null;
  }): Promise<Round> {
    const r: Round = { id: randomUUID(), ...input };
    this.rounds.set(r.id, r);
    return r;
  }
  async updateRound(
    id: string,
    patch: Partial<{ name: string; is_open: boolean; allow_edit_after_submit: boolean; closes_at: string | null }>,
  ): Promise<Round | null> {
    const r = this.rounds.get(id);
    if (!r) return null;
    Object.assign(r, patch);
    return r;
  }

  async listCriteria(roundId: string): Promise<Criterion[]> {
    return [...this.criteria.values()]
      .filter((c) => c.round_id === roundId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }
  async createCriterion(input: Omit<Criterion, 'id' | 'created_at'>): Promise<Criterion> {
    const c: Criterion = { id: randomUUID(), ...input };
    this.criteria.set(c.id, c);
    return c;
  }
  async updateCriterion(id: string, patch: Partial<Criterion>): Promise<Criterion | null> {
    const c = this.criteria.get(id);
    if (!c) return null;
    Object.assign(c, patch);
    return c;
  }

  async getEvaluation(id: string): Promise<EvaluationWithScores | null> {
    const e = this.evaluations.get(id);
    if (!e) return null;
    return this.withScores(e);
  }
  async getOfficialEvaluation(
    judgeId: string,
    candidateId: string,
    roundId: string,
  ): Promise<EvaluationWithScores | null> {
    for (const e of this.evaluations.values()) {
      if (
        e.judge_id === judgeId &&
        e.candidate_id === candidateId &&
        e.round_id === roundId &&
        e.status === 'submitted'
      ) {
        return this.withScores(e);
      }
    }
    return null;
  }
  async listEvaluations(filter: {
    admin: boolean;
    judgeId?: string;
    candidateId?: string;
    panelIds?: string[];
  }): Promise<EvaluationWithScores[]> {
    const out: EvaluationWithScores[] = [];
    for (const e of this.evaluations.values()) {
      if (!filter.admin) {
        if (filter.judgeId && e.judge_id !== filter.judgeId) continue;
        if (filter.panelIds && !filter.panelIds.includes(e.panel_id)) continue;
      } else if (filter.judgeId && e.judge_id !== filter.judgeId) continue;
      if (filter.candidateId && e.candidate_id !== filter.candidateId) continue;
      out.push(await this.withScores(e));
    }
    return out.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  }

  async submitEvaluation(
    judgeId: string,
    input: SubmitEvaluationInput,
    computed: { overall_score: number | null; scores: CriterionScore[] },
    opts: { replaceExisting: boolean },
  ): Promise<SubmitOutcome> {
    if (this.evaluations.has(input.id)) {
      const existing = this.evaluations.get(input.id)!;
      if (existing.judge_id !== judgeId) {
        return { status: 'error', message: 'Evaluation ID already used' };
      }
      const samePayload =
        existing.feedback === input.feedback &&
        existing.overall_score === computed.overall_score &&
        JSON.stringify([...(this.criterionScores.get(input.id) ?? [])].sort((a, b) => a.criterion_id.localeCompare(b.criterion_id))) ===
          JSON.stringify([...computed.scores].sort((a, b) => a.criterion_id.localeCompare(b.criterion_id)));
      if (samePayload) {
        return { status: 'ok', evaluation: await this.withScores(existing), idempotent: true };
      }
      // Same client id, different payload: an offline edit of a synced item.
      const round = this.rounds.get(input.round_id);
      if (opts.replaceExisting && round?.allow_edit_after_submit) {
        existing.feedback = input.feedback;
        existing.overall_score = computed.overall_score;
        existing.version += 1;
        existing.updated_at = this.now();
        this.criterionScores.set(existing.id, computed.scores);
        return { status: 'ok', evaluation: await this.withScores(existing) };
      }
      // Never silently overwrite: keep the server copy, report idempotent.
      return { status: 'ok', evaluation: await this.withScores(existing), idempotent: true };
    }
    const candidate = this.candidates.get(input.candidate_id);
    if (!candidate || candidate.archived_at) {
      return { status: 'error', message: 'Candidate not found' };
    }
    const round = this.rounds.get(input.round_id);
    if (!round) return { status: 'error', message: 'Round not found' };
    const official = await this.getOfficialEvaluation(judgeId, input.candidate_id, input.round_id);
    if (official) {
      if (opts.replaceExisting && round.allow_edit_after_submit) {
        official.feedback = input.feedback;
        official.overall_score = computed.overall_score;
        official.version += 1;
        official.updated_at = this.now();
        this.criterionScores.set(official.id, computed.scores);
        return { status: 'ok', evaluation: await this.withScores(official) };
      }
      return { status: 'duplicate', existing: official };
    }
    const e: Evaluation = {
      id: input.id,
      candidate_id: input.candidate_id,
      judge_id: judgeId,
      panel_id: candidate.panel_id,
      round_id: input.round_id,
      status: 'submitted',
      overall_score: computed.overall_score,
      feedback: input.feedback,
      version: 1,
      client_created_at: input.client_created_at ?? null,
      submitted_at: this.now(),
      updated_at: this.now(),
    };
    this.evaluations.set(e.id, e);
    this.criterionScores.set(e.id, computed.scores);
    return { status: 'ok', evaluation: await this.withScores(e) };
  }

  async updateEvaluation(
    id: string,
    judgeId: string,
    patch: { feedback: string; overall_score: number | null; scores: CriterionScore[] },
  ): Promise<SubmitOutcome> {
    const e = this.evaluations.get(id);
    if (!e) return { status: 'error', message: 'Evaluation not found' };
    if (e.judge_id !== judgeId) return { status: 'error', message: 'Not your evaluation' };
    e.feedback = patch.feedback;
    e.overall_score = patch.overall_score;
    e.version += 1;
    e.updated_at = this.now();
    this.criterionScores.set(e.id, patch.scores);
    return { status: 'ok', evaluation: await this.withScores(e) };
  }

  async results(scope: CandidateScope, filters: CandidateFilters): Promise<ResultRow[]> {
    const all = [...this.candidates.values()].filter((c) => {
      if (!scope.admin && !(scope.panelIds ?? []).includes(c.panel_id)) return false;
      if (!filters.includeArchived && c.archived_at) return false;
      if (filters.panelId && c.panel_id !== filters.panelId) return false;
      if (filters.branch && !c.branch.toLowerCase().includes(filters.branch.toLowerCase())) return false;
      if (filters.interviewStatus && c.interview_status !== filters.interviewStatus) return false;
      if (filters.shortlistingStatus && c.shortlisting_status !== filters.shortlistingStatus) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (!`${c.full_name} ${c.application_id ?? ''}`.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    const rows: ResultRow[] = [];
    for (const c of all) {
      const submitted = [...this.evaluations.values()].filter(
        (e) => e.candidate_id === c.id && e.status === 'submitted',
      );
      const panel = this.panels.get(c.panel_id)!;
      const scores = submitted.map((e) => e.overall_score).filter((s): s is number => s !== null);
      const count = submitted.length;
      const expected = panel?.expected_evaluations ?? 1;
      rows.push({
        candidate_id: c.id,
        full_name: c.full_name,
        branch: c.branch,
        application_id: c.application_id,
        panel_id: c.panel_id,
        panel_name: panel?.name ?? '',
        expected_evaluations: expected,
        interview_status: c.interview_status,
        shortlisting_status: c.shortlisting_status,
        evaluation_count: count,
        average_score: meanOrNull(scores),
        evaluation_status: count === 0 ? 'not_started' : count < expected ? 'in_progress' : 'complete',
        archived_at: c.archived_at,
        judge_ratings: submitted.map((e) => ({
          judge_id: e.judge_id,
          judge_name: this.profiles.get(e.judge_id)?.full_name ?? '',
          score: e.overall_score,
          evaluation_id: e.id,
          submitted_at: e.submitted_at,
          version: e.version,
        })),
      });
    }
    const order = filters.order === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      let cmp = 0;
      switch (filters.sort) {
        case 'branch':
          cmp = a.branch.localeCompare(b.branch);
          break;
        case 'average':
          cmp = (a.average_score ?? -1) - (b.average_score ?? -1);
          break;
        case 'created':
          cmp = a.candidate_id.localeCompare(b.candidate_id);
          break;
        default:
          cmp = a.full_name.localeCompare(b.full_name);
      }
      if (cmp === 0) cmp = a.full_name.localeCompare(b.full_name);
      return cmp * order;
    });
    return rows;
  }

  async audit(entry: AuditEntry): Promise<void> {
    this.audits.push(entry);
  }

  private async withScores(e: Evaluation): Promise<EvaluationWithScores> {
    return {
      ...e,
      scores: this.criterionScores.get(e.id) ?? [],
      judge_name: this.profiles.get(e.judge_id)?.full_name,
      candidate_name: this.candidates.get(e.candidate_id)?.full_name,
      round_name: this.rounds.get(e.round_id)?.name,
    };
  }
}

export const round2Export = round2;
