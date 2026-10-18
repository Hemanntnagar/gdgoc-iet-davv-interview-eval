import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { meanOrNull } from '../lib/scoring.js';
import type {
  AuditEntry,
  Candidate,
  CandidateFilters,
  CandidateScope,
  Criterion,
  CriterionScore,
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

/* eslint-disable @typescript-eslint/no-explicit-any */

function unwrap<T>(res: { data: T; error: any }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? res.error}`);
  return res.data as T;
}

export class SupabaseStore implements Store {
  private sb: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.sb = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  // ---- profiles ----------------------------------------------------------
  async getProfile(id: string): Promise<Profile | null> {
    const { data, error } = await this.sb.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getProfile: ${error.message}`);
    return data as Profile | null;
  }
  async getProfilesByIds(ids: string[]): Promise<Profile[]> {
    if (ids.length === 0) return [];
    return unwrap(
      await this.sb.from('profiles').select('*').in('id', ids),
      'getProfilesByIds',
    ) as Profile[];
  }
  async listProfiles(role?: Role): Promise<Profile[]> {
    let q = this.sb.from('profiles').select('*').order('created_at', { ascending: true });
    if (role) q = q.eq('role', role);
    return unwrap(await q, 'listProfiles') as Profile[];
  }
  async createProfile(input: { id: string; email: string; full_name: string; role: Role }): Promise<Profile> {
    return unwrap(
      await this.sb
        .from('profiles')
        .insert({ ...input, is_active: true })
        .select('*')
        .single(),
      'createProfile',
    ) as Profile;
  }
  async setProfileRole(userId: string, role: Role): Promise<Profile | null> {
    const { data, error } = await this.sb
      .from('profiles')
      .update({ role })
      .eq('id', userId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`setProfileRole: ${error.message}`);
    return data as Profile | null;
  }
  async setProfileActive(userId: string, isActive: boolean): Promise<Profile | null> {
    const { data, error } = await this.sb
      .from('profiles')
      .update({ is_active: isActive })
      .eq('id', userId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`setProfileActive: ${error.message}`);
    return data as Profile | null;
  }

  // ---- panels ------------------------------------------------------------
  async listPanels(): Promise<Panel[]> {
    return unwrap(await this.sb.from('panels').select('*').order('name'), 'listPanels') as Panel[];
  }
  async getPanel(id: string): Promise<Panel | null> {
    const { data, error } = await this.sb.from('panels').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getPanel: ${error.message}`);
    return data as Panel | null;
  }
  async createPanel(input: { name: string; expected_evaluations: number }): Promise<Panel> {
    return unwrap(
      await this.sb.from('panels').insert(input).select('*').single(),
      'createPanel',
    ) as Panel;
  }
  async updatePanel(
    id: string,
    patch: { name?: string; is_active?: boolean; expected_evaluations?: number },
  ): Promise<Panel | null> {
    const { data, error } = await this.sb
      .from('panels')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`updatePanel: ${error.message}`);
    return data as Panel | null;
  }
  async listMyPanels(judgeId: string): Promise<Panel[]> {
    const rows = (await unwrap(
      await this.sb
        .from('panel_members')
        .select('panels(*)')
        .eq('judge_id', judgeId),
      'listMyPanels',
    )) as unknown as any[] | null;
    return (rows ?? []).map((row: any) => row.panels as Panel).filter(Boolean);
  }

  // ---- panel codes -------------------------------------------------------
  async createPanelCode(input: {
    panel_id: string;
    code_hash: string;
    label: string;
    preview: string;
    expires_at?: string | null;
  }): Promise<PanelCodeMeta> {
    const row = unwrap(
      await this.sb
        .from('panel_codes')
        .insert({
          panel_id: input.panel_id,
          code_hash: input.code_hash,
          label: input.label,
          preview: input.preview,
          expires_at: input.expires_at ?? null,
        })
        .select('*')
        .single(),
      'createPanelCode',
    ) as any;
    return this.toCodeMeta(row);
  }
  async rotatePanelCode(input: {
    panel_id: string;
    code_hash: string;
    label: string;
    preview: string;
    expires_at?: string | null;
  }): Promise<PanelCodeMeta> {
    await this.sb
      .from('panel_codes')
      .update({ is_active: false, rotated_at: new Date().toISOString() })
      .eq('panel_id', input.panel_id)
      .eq('is_active', true);
    const row = unwrap(
      await this.sb
        .from('panel_codes')
        .insert({
          panel_id: input.panel_id,
          code_hash: input.code_hash,
          label: input.label,
          preview: input.preview,
          expires_at: input.expires_at ?? null,
        })
        .select('*')
        .single(),
      'rotatePanelCode',
    ) as any;
    return this.toCodeMeta(row);
  }
  async setPanelCodeActive(codeId: string, isActive: boolean): Promise<PanelCodeMeta | null> {
    const { data, error } = await this.sb
      .from('panel_codes')
      .update({ is_active: isActive, rotated_at: isActive ? null : new Date().toISOString() })
      .eq('id', codeId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`setPanelCodeActive: ${error.message}`);
    return data ? this.toCodeMeta(data as any) : null;
  }
  async listPanelCodes(panelId: string): Promise<PanelCodeMeta[]> {
    const rows = unwrap(
      await this.sb
        .from('panel_codes')
        .select('*')
        .eq('panel_id', panelId)
        .order('created_at', { ascending: false }),
      'listPanelCodes',
    ) as any[];
    return rows.map((r) => this.toCodeMeta(r));
  }
  private toCodeMeta(row: any): PanelCodeMeta {
    return {
      id: row.id,
      panel_id: row.panel_id,
      label: row.label ?? '',
      is_active: row.is_active,
      max_attempts: row.max_attempts,
      failed_attempts: row.failed_attempts,
      locked_until: row.locked_until,
      expires_at: row.expires_at,
      created_at: row.created_at,
      rotated_at: row.rotated_at,
      code_preview: row.preview ?? '',
    };
  }

  async verifyPanelCode(input: {
    code_hash: string;
    judge_id: string;
    lockout_minutes: number;
  }): Promise<VerifyOutcome> {
    const { data: rows, error } = await this.sb
      .from('panel_codes')
      .select('*, panels(*)')
      .eq('code_hash', input.code_hash)
      .eq('is_active', true);
    if (error) throw new Error(`verifyPanelCode: ${error.message}`);
    const now = Date.now();
    const list = (rows ?? []).filter(
      (r: any) => !r.expires_at || new Date(r.expires_at).getTime() > now,
    );
    if (list.length === 0) return { status: 'invalid' };
    const code = list[0] as any;
    if (code.locked_until && new Date(code.locked_until).getTime() > now) {
      return { status: 'locked', retry_at: code.locked_until };
    }
    const panel = code.panels as Panel | null;
    if (!panel) return { status: 'invalid' };
    if (!panel.is_active) {
      const lockedUntil = await this.recordFailedCodeAttempt(
        code.id,
        code.max_attempts ?? 5,
        input.lockout_minutes,
      );
      if (lockedUntil) return { status: 'locked', retry_at: lockedUntil };
      return { status: 'panel_inactive' };
    }
    await this.sb
      .from('panel_codes')
      .update({ failed_attempts: 0, locked_until: null })
      .eq('id', code.id);
    const { error: memberErr } = await this.sb.from('panel_members').upsert(
      {
        panel_id: panel.id,
        judge_id: input.judge_id,
        verified_at: new Date().toISOString(),
      },
      { onConflict: 'panel_id,judge_id', ignoreDuplicates: true },
    );
    if (memberErr) throw new Error(`verifyPanelCode membership: ${memberErr.message}`);
    return { status: 'ok', panel };
  }

  /** Record a failed verification attempt; lock the code when attempts are exhausted. */
  async recordFailedCodeAttempt(codeId: string, maxAttempts: number, lockoutMinutes: number): Promise<string | null> {
    const { data: code, error } = await this.sb
      .from('panel_codes')
      .select('failed_attempts')
      .eq('id', codeId)
      .single();
    if (error) return null;
    const attempts = (code.failed_attempts ?? 0) + 1;
    let lockedUntil: string | null = null;
    if (attempts >= maxAttempts) {
      lockedUntil = new Date(Date.now() + lockoutMinutes * 60_000).toISOString();
    }
    await this.sb
      .from('panel_codes')
      .update({ failed_attempts: attempts, locked_until: lockedUntil })
      .eq('id', codeId);
    return lockedUntil;
  }

  async addPanelMember(panelId: string, judgeId: string, assignedBy: string | null): Promise<void> {
    const { error } = await this.sb.from('panel_members').upsert(
      { panel_id: panelId, judge_id: judgeId, assigned_by: assignedBy },
      { onConflict: 'panel_id,judge_id', ignoreDuplicates: true },
    );
    if (error) throw new Error(`addPanelMember: ${error.message}`);
  }
  async removePanelMember(panelId: string, judgeId: string): Promise<boolean> {
    const { data, error } = await this.sb
      .from('panel_members')
      .delete()
      .eq('panel_id', panelId)
      .eq('judge_id', judgeId)
      .select('judge_id');
    if (error) throw new Error(`removePanelMember: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
  async listPanelMembers(panelId: string): Promise<{ judge_id: string; judge_name: string; verified_at: string | null }[]> {
    const rows = unwrap(
      await this.sb
        .from('panel_members')
        .select('judge_id, verified_at, profiles(full_name)')
        .eq('panel_id', panelId),
      'listPanelMembers',
    ) as any[];
    return rows.map((r) => ({
      judge_id: r.judge_id,
      judge_name: (r.profiles as any)?.full_name ?? '',
      verified_at: r.verified_at,
    }));
  }

  // ---- candidates --------------------------------------------------------
  private scopeFilter(q: any, scope: CandidateScope) {
    if (!scope.admin) {
      q = q.in('panel_id', scope.panelIds ?? []);
    }
    return q;
  }
  async listCandidates(scope: CandidateScope, filters: CandidateFilters): Promise<Candidate[]> {
    let q = this.sb.from('candidate_results').select('*');
    q = this.scopeFilter(q, scope);
    if (!filters.includeArchived) q = q.is('archived_at', null);
    if (filters.panelId) q = q.eq('panel_id', filters.panelId);
    if (filters.interviewStatus) q = q.eq('interview_status', filters.interviewStatus);
    if (filters.shortlistingStatus) q = q.eq('shortlisting_status', filters.shortlistingStatus);
    if (filters.evaluationStatus) q = q.eq('evaluation_status', filters.evaluationStatus);
    if (filters.branch) q = q.ilike('branch', `%${filters.branch}%`);
    if (filters.search) {
      const s = `%${filters.search}%`;
      q = q.or(`full_name.ilike.${s},application_id.ilike.${s}`);
    }
    const asc = filters.order !== 'desc';
    switch (filters.sort) {
      case 'branch':
        q = q.order('branch', { ascending: asc }).order('full_name', { ascending: true });
        break;
      case 'average':
        q = q.order('average_score', { ascending: asc, nullsFirst: false }).order('full_name', { ascending: true });
        break;
      case 'created':
        q = q.order('candidate_id', { ascending: asc });
        break;
      default:
        q = q.order('full_name', { ascending: asc });
    }
    const rows = unwrap(await q, 'listCandidates') as any[];
    return rows.map((r) => this.toCandidate(r, scope.admin));
  }
  private toCandidate(r: any, admin: boolean): Candidate {
    return {
      id: r.candidate_id ?? r.id,
      full_name: r.full_name,
      branch: r.branch ?? '',
      application_id: r.application_id ?? null,
      panel_id: r.panel_id,
      interview_status: r.interview_status,
      shortlisting_status: r.shortlisting_status,
      notes: admin ? (r.notes ?? '') : '',
      archived_at: r.archived_at ?? null,
      created_at: r.created_at ?? '',
      updated_at: r.updated_at ?? '',
    };
  }
  async getCandidate(id: string, scope: CandidateScope): Promise<Candidate | null> {
    let q = this.sb.from('candidates').select('*').eq('id', id);
    q = this.scopeFilter(q, scope);
    const { data, error } = await q.maybeSingle();
    if (error) throw new Error(`getCandidate: ${error.message}`);
    return data ? this.toCandidate(data, scope.admin) : null;
  }
  async createCandidate(
    input: { full_name: string; branch: string; application_id: string | null; panel_id: string },
    actorId: string,
  ): Promise<Candidate> {
    return unwrap(
      await this.sb
        .from('candidates')
        .insert({ ...input, application_id: input.application_id || null, created_by: actorId })
        .select('*')
        .single(),
      'createCandidate',
    ) as unknown as Candidate;
  }
  async updateCandidate(id: string, patch: Record<string, unknown>): Promise<Candidate | null> {
    const { data, error } = await this.sb
      .from('candidates')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`updateCandidate: ${error.message}`);
    return (data as Candidate) ?? null;
  }
  async archiveCandidate(id: string, archived: boolean): Promise<Candidate | null> {
    return this.updateCandidate(id, { archived_at: archived ? new Date().toISOString() : null });
  }
  async bulkCreateCandidates(
    rows: { full_name: string; branch: string; application_id: string | null; panel_id: string }[],
    actorId: string,
  ): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, skipped_duplicates: 0, errors: [] };
    const seen = new Set<string>();
    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      if (!row.full_name) {
        result.errors.push({ row: i + 2, message: 'full_name is required' });
        continue;
      }
      const panel = await this.getPanel(row.panel_id);
      if (!panel) {
        result.errors.push({ row: i + 2, message: `Panel not found for row` });
        continue;
      }
      if (row.application_id) {
        const { data: dup } = await this.sb
          .from('candidates')
          .select('id')
          .eq('application_id', row.application_id)
          .maybeSingle();
        if (dup || seen.has(row.application_id)) {
          result.skipped_duplicates += 1;
          continue;
        }
        seen.add(row.application_id);
      }
      try {
        await this.createCandidate(row, actorId);
        result.imported += 1;
      } catch (e: any) {
        if (String(e?.message ?? e).includes('23505') || String(e?.message ?? e).toLowerCase().includes('duplicate')) {
          result.skipped_duplicates += 1;
        } else {
          result.errors.push({ row: i + 2, message: String(e?.message ?? e) });
        }
      }
    }
    return result;
  }

  // ---- rounds & criteria ---------------------------------------------------
  async listRounds(): Promise<Round[]> {
    return unwrap(await this.sb.from('evaluation_rounds').select('*'), 'listRounds') as Round[];
  }
  async getRound(id: string): Promise<Round | null> {
    const { data, error } = await this.sb
      .from('evaluation_rounds')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`getRound: ${error.message}`);
    return data as Round | null;
  }
  async createRound(input: {
    name: string;
    is_open: boolean;
    allow_edit_after_submit: boolean;
    closes_at: string | null;
  }): Promise<Round> {
    return unwrap(
      await this.sb.from('evaluation_rounds').insert(input).select('*').single(),
      'createRound',
    ) as Round;
  }
  async updateRound(id: string, patch: Record<string, unknown>): Promise<Round | null> {
    const { data, error } = await this.sb
      .from('evaluation_rounds')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`updateRound: ${error.message}`);
    return (data as Round) ?? null;
  }
  async listCriteria(roundId: string): Promise<Criterion[]> {
    return unwrap(
      await this.sb
        .from('criteria')
        .select('*')
        .eq('round_id', roundId)
        .order('sort_order'),
      'listCriteria',
    ) as Criterion[];
  }
  async createCriterion(input: Omit<Criterion, 'id' | 'created_at'>): Promise<Criterion> {
    return unwrap(
      await this.sb.from('criteria').insert(input).select('*').single(),
      'createCriterion',
    ) as Criterion;
  }
  async updateCriterion(id: string, patch: Partial<Criterion>): Promise<Criterion | null> {
    const { data, error } = await this.sb
      .from('criteria')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`updateCriterion: ${error.message}`);
    return (data as Criterion) ?? null;
  }

  // ---- evaluations ---------------------------------------------------------
  async getEvaluation(id: string): Promise<EvaluationWithScores | null> {
    const { data: e, error } = await this.sb.from('evaluations').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`getEvaluation: ${error.message}`);
    if (!e) return null;
    const scores = unwrap(
      await this.sb.from('criterion_scores').select('*').eq('evaluation_id', id),
      'getEvaluation scores',
    ) as any[];
    const judge = await this.getProfile((e as any).judge_id);
    return {
      ...(e as any),
      scores: scores.map((s) => ({ criterion_id: s.criterion_id, score: Number(s.score) })),
      judge_name: judge?.full_name,
    };
  }
  async getOfficialEvaluation(
    judgeId: string,
    candidateId: string,
    roundId: string,
  ): Promise<EvaluationWithScores | null> {
    const { data, error } = await this.sb
      .from('evaluations')
      .select('id')
      .eq('judge_id', judgeId)
      .eq('candidate_id', candidateId)
      .eq('round_id', roundId)
      .eq('status', 'submitted')
      .maybeSingle();
    if (error) throw new Error(`getOfficialEvaluation: ${error.message}`);
    if (!data) return null;
    return this.getEvaluation((data as any).id);
  }
  async listEvaluations(filter: {
    admin: boolean;
    judgeId?: string;
    candidateId?: string;
    panelIds?: string[];
  }): Promise<EvaluationWithScores[]> {
    let q = this.sb.from('evaluations').select('*');
    if (filter.judgeId) q = q.eq('judge_id', filter.judgeId);
    if (filter.candidateId) q = q.eq('candidate_id', filter.candidateId);
    if (!filter.admin && filter.panelIds) q = q.in('panel_id', filter.panelIds);
    q = q.order('submitted_at', { ascending: false }).limit(1000);
    const rows = unwrap(await q, 'listEvaluations') as any[];
    const out: EvaluationWithScores[] = [];
    for (const r of rows.slice(0, 200)) {
      const full = await this.getEvaluation(r.id);
      if (full) out.push(full);
    }
    return out;
  }

  async submitEvaluation(
    judgeId: string,
    input: SubmitEvaluationInput,
    computed: { overall_score: number | null; scores: CriterionScore[] },
    opts: { replaceExisting: boolean },
  ): Promise<SubmitOutcome> {
    // Idempotency: same client-generated id already stored for this judge.
    const { data: sameId } = await this.sb
      .from('evaluations')
      .select('*')
      .eq('id', input.id)
      .maybeSingle();
    if (sameId) {
      if ((sameId as any).judge_id !== judgeId) {
        return { status: 'error', message: 'Evaluation ID already used' };
      }
      const existing = await this.getEvaluation(input.id);
      if (!existing) return { status: 'error', message: 'Evaluation lookup failed' };
      const sorted = (xs: { criterion_id: string; score: number }[]) =>
        [...xs].sort((a, b) => a.criterion_id.localeCompare(b.criterion_id));
      const samePayload =
        existing.feedback === input.feedback &&
        Number(existing.overall_score) === Number(computed.overall_score) &&
        JSON.stringify(sorted(existing.scores)) === JSON.stringify(sorted(computed.scores));
      if (samePayload) return { status: 'ok', evaluation: existing, idempotent: true };
      const round = await this.getRound(input.round_id);
      if (opts.replaceExisting && round?.allow_edit_after_submit) {
        return this.updateEvaluation(input.id, judgeId, {
          feedback: input.feedback,
          overall_score: computed.overall_score,
          scores: computed.scores,
        });
      }
      return { status: 'ok', evaluation: existing, idempotent: true };
    }
    const { data: cand } = await this.sb
      .from('candidates')
      .select('id, panel_id, archived_at')
      .eq('id', input.candidate_id)
      .maybeSingle();
    if (!cand || (cand as any).archived_at) {
      return { status: 'error', message: 'Candidate not found' };
    }
    const round = await this.getRound(input.round_id);
    if (!round) return { status: 'error', message: 'Round not found' };

    const official = await this.getOfficialEvaluation(judgeId, input.candidate_id, input.round_id);
    if (official) {
      if (opts.replaceExisting && round.allow_edit_after_submit) {
        return this.updateEvaluation(official.id, judgeId, {
          feedback: input.feedback,
          overall_score: computed.overall_score,
          scores: computed.scores,
        });
      }
      return { status: 'duplicate', existing: official };
    }

    const { error } = await this.sb.from('evaluations').insert({
      id: input.id,
      candidate_id: input.candidate_id,
      judge_id: judgeId,
      panel_id: (cand as any).panel_id,
      round_id: input.round_id,
      status: 'submitted',
      overall_score: computed.overall_score,
      feedback: input.feedback,
      client_created_at: input.client_created_at ?? null,
    });
    if (error) {
      // Unique violation from a concurrent insert — surface as duplicate.
      if (error.code === '23505') {
        const existing = await this.getOfficialEvaluation(judgeId, input.candidate_id, input.round_id);
        if (existing) return { status: 'duplicate', existing };
      }
      return { status: 'error', message: error.message };
    }
    if (computed.scores.length > 0) {
      const { error: scoreErr } = await this.sb.from('criterion_scores').insert(
        computed.scores.map((s) => ({
          evaluation_id: input.id,
          criterion_id: s.criterion_id,
          score: s.score,
        })),
      );
      if (scoreErr) return { status: 'error', message: `Failed to save scores: ${scoreErr.message}` };
    }
    const saved = await this.getEvaluation(input.id);
    return saved ? { status: 'ok', evaluation: saved } : { status: 'error', message: 'Save verification failed' };
  }

  async updateEvaluation(
    id: string,
    judgeId: string,
    patch: { feedback: string; overall_score: number | null; scores: CriterionScore[] },
  ): Promise<SubmitOutcome> {
    const existing = await this.getEvaluation(id);
    if (!existing) return { status: 'error', message: 'Evaluation not found' };
    if (existing.judge_id !== judgeId) return { status: 'error', message: 'Not your evaluation' };
    const { error } = await this.sb
      .from('evaluations')
      .update({
        feedback: patch.feedback,
        overall_score: patch.overall_score,
        version: existing.version + 1,
      })
      .eq('id', id)
      .eq('version', existing.version); // optimistic lock
    if (error) return { status: 'error', message: error.message };
    await this.sb.from('criterion_scores').delete().eq('evaluation_id', id);
    if (patch.scores.length > 0) {
      await this.sb.from('criterion_scores').insert(
        patch.scores.map((s) => ({ evaluation_id: id, criterion_id: s.criterion_id, score: s.score })),
      );
    }
    const saved = await this.getEvaluation(id);
    return saved ? { status: 'ok', evaluation: saved } : { status: 'error', message: 'Update verification failed' };
  }

  async results(scope: CandidateScope, filters: CandidateFilters): Promise<ResultRow[]> {
    let q = this.sb.from('candidate_results').select('*');
    q = this.scopeFilter(q, scope);
    if (!filters.includeArchived) q = q.is('archived_at', null);
    if (filters.panelId) q = q.eq('panel_id', filters.panelId);
    if (filters.interviewStatus) q = q.eq('interview_status', filters.interviewStatus);
    if (filters.shortlistingStatus) q = q.eq('shortlisting_status', filters.shortlistingStatus);
    if (filters.evaluationStatus) q = q.eq('evaluation_status', filters.evaluationStatus);
    if (filters.branch) q = q.ilike('branch', `%${filters.branch}%`);
    if (filters.search) {
      const s = `%${filters.search}%`;
      q = q.or(`full_name.ilike.${s},application_id.ilike.${s}`);
    }
    const asc = filters.order !== 'desc';
    switch (filters.sort) {
      case 'branch':
        q = q.order('branch', { ascending: asc }).order('full_name', { ascending: true });
        break;
      case 'average':
        q = q.order('average_score', { ascending: asc, nullsFirst: false }).order('full_name', { ascending: true });
        break;
      case 'created':
        q = q.order('candidate_id', { ascending: asc });
        break;
      default:
        q = q.order('full_name', { ascending: asc });
    }
    const rows = unwrap(await q, 'results') as any[];
    return rows.map((r) => ({
      candidate_id: r.candidate_id,
      full_name: r.full_name,
      branch: r.branch ?? '',
      application_id: r.application_id ?? null,
      panel_id: r.panel_id,
      panel_name: r.panel_name ?? '',
      expected_evaluations: r.expected_evaluations ?? 1,
      interview_status: r.interview_status,
      shortlisting_status: r.shortlisting_status,
      evaluation_status: r.evaluation_status,
      evaluation_count: r.evaluation_count ?? 0,
      average_score: r.average_score === null || r.average_score === undefined ? null : Number(r.average_score),
      archived_at: r.archived_at ?? null,
      judge_ratings: (r.judge_ratings ?? []).map((jr: any) => ({
        ...jr,
        score: jr.score === null ? null : Number(jr.score),
      })),
    }));
  }

  async audit(entry: AuditEntry): Promise<void> {
    await this.sb.from('audit_events').insert({
      actor_id: entry.actor_id,
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      details: entry.details,
    });
  }
}

export const mean = meanOrNull;
