import { Router, type Response } from 'express';
import * as XLSX from 'xlsx';
import { badRequest, HttpError } from '../lib/errors.js';
import { toCsv } from '../lib/csv.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { candidateFiltersSchema } from '../lib/validate.js';
import { displayScore } from '../lib/rubric.js';
import type { Store, ResultRow, EvaluationWithScores } from '../store/types.js';

/**
 * Reports + exports (admin only). Four export types, each as CSV or XLSX:
 *  1. summary        — one row per applicant: final average + completion
 *  2. individual     — one row per judge rating (individual scores)
 *  3. criterion      — one row per criterion score (+ written feedback)
 *  4. vertical       — per-vertical rollups (counts, averages, completion)
 */

type ExportType = 'summary' | 'individual' | 'criterion' | 'vertical';
type ExportFormat = 'csv' | 'xlsx';

const EXPORT_TYPES: ExportType[] = ['summary', 'individual', 'criterion', 'vertical'];
const EXPORT_FORMATS: ExportFormat[] = ['csv', 'xlsx'];

function isAdmin(req: AuthedRequest) {
  if (req.user!.role !== 'admin') throw new HttpError(403, 'forbidden', 'Administrator access required');
}

function scoreText(n: number | null): string {
  return n === null ? '' : displayScore(Number(n));
}

async function buildSummary(store: Store, rows: ResultRow[]): Promise<{ headers: string[]; data: (string | number)[][] }> {
  return {
    headers: [
      'roll_number',
      'applicant_name',
      'vertical',
      'shift',
      'priority',
      'branch',
      'panel',
      'evaluations_received',
      'evaluations_expected',
      'completion',
      'final_average',
      'interview_status',
      'shortlisting_status',
      'archived',
    ],
    data: rows.map((r) => [
      r.roll_number || r.application_id || '',
      r.full_name,
      r.vertical_name ?? '',
      r.shift ?? '',
      r.priority ?? '',
      r.branch,
      r.panel_name,
      r.evaluation_count,
      r.expected_evaluations,
      r.is_provisional ? 'provisional' : r.evaluation_status,
      scoreText(r.average_score),
      r.interview_status,
      r.shortlisting_status,
      r.archived_at ? 'yes' : 'no',
    ]),
  };
}

async function buildIndividual(
  store: Store,
  rows: ResultRow[],
): Promise<{ headers: string[]; data: (string | number)[][] }> {
  const data: (string | number)[][] = [];
  for (const row of rows) {
    const evaluations = await store.listEvaluations({ admin: true, candidateId: row.candidate_id });
    for (const e of evaluations) {
      data.push([
        row.roll_number || row.application_id || '',
        row.full_name,
        row.vertical_name ?? '',
        row.shift ?? '',
        row.panel_name,
        e.judge_name ?? e.judge_id,
        scoreText(e.overall_score),
        row.average_score === null ? '' : scoreText(row.average_score),
        row.evaluation_count,
        row.expected_evaluations,
        row.is_provisional ? 'provisional' : 'complete',
        e.submitted_at,
        e.version,
      ]);
    }
    if (evaluations.length === 0) {
      data.push([row.roll_number || row.application_id || '', row.full_name, row.vertical_name ?? '', row.shift ?? '', row.panel_name, '', '', scoreText(row.average_score), 0, row.expected_evaluations, 'not_started', '', '']);
    }
  }
  return {
    headers: [
      'roll_number',
      'applicant_name',
      'vertical',
      'shift',
      'panel',
      'judge',
      'individual_score',
      'final_average',
      'evaluations_received',
      'evaluations_expected',
      'completion',
      'submitted_at',
      'version',
    ],
    data,
  };
}

async function buildCriterion(
  store: Store,
  rows: ResultRow[],
): Promise<{ headers: string[]; data: (string | number)[][] }> {
  const data: (string | number)[][] = [];
  const criteriaCache = new Map<string, string>();
  for (const row of rows) {
    const evaluations = await store.listEvaluations({ admin: true, candidateId: row.candidate_id });
    for (const e of evaluations) {
      const roundCriteria = await store.listCriteria(e.round_id);
      for (const s of e.scores) {
        let name = criteriaCache.get(s.criterion_id);
        if (!name) {
          name = roundCriteria.find((c) => c.id === s.criterion_id)?.name ?? s.criterion_id;
          criteriaCache.set(s.criterion_id, name);
        }
        data.push([
          row.roll_number || row.application_id || '',
          row.full_name,
          row.vertical_name ?? '',
          row.panel_name,
          e.judge_name ?? e.judge_id,
          name,
          s.score,
          s.feedback ?? '',
          e.overall_score === null ? '' : scoreText(e.overall_score),
          e.submitted_at,
        ]);
      }
    }
  }
  return {
    headers: [
      'roll_number',
      'applicant_name',
      'vertical',
      'panel',
      'judge',
      'criterion',
      'score_1_to_5',
      'criterion_feedback',
      'individual_score',
      'submitted_at',
    ],
    data,
  };
}

async function buildVertical(
  store: Store,
  rows: ResultRow[],
): Promise<{ headers: string[]; data: (string | number)[][] }> {
  const groups = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const key = r.vertical_name ?? 'Unassigned';
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const data: (string | number)[][] = [];
  for (const [vertical, group] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const scored = group.filter((g) => g.average_score !== null);
    const avg = scored.length
      ? scored.reduce((s, g) => s + Number(g.average_score), 0) / scored.length
      : null;
    const complete = group.filter((g) => !g.is_provisional && g.evaluation_count > 0).length;
    const shifts = [...new Set(group.map((g) => g.shift).filter(Boolean))].join(', ');
    data.push([
      vertical,
      shifts,
      group.length,
      group.filter((g) => g.evaluation_count > 0).length,
      complete,
      group.filter((g) => g.is_provisional).length,
      group.filter((g) => g.shortlisting_status === 'shortlisted').length,
      avg === null ? '' : displayScore(avg),
    ]);
  }
  return {
    headers: [
      'vertical',
      'shifts',
      'applicants',
      'evaluated',
      'complete',
      'provisional',
      'shortlisted',
      'avg_of_averages',
    ],
    data,
  };
}

async function buildReport(
  store: Store,
  type: ExportType,
  rows: ResultRow[],
): Promise<{ headers: string[]; data: (string | number)[][] }> {
  switch (type) {
    case 'summary':
      return buildSummary(store, rows);
    case 'individual':
      return buildIndividual(store, rows);
    case 'criterion':
      return buildCriterion(store, rows);
    case 'vertical':
      return buildVertical(store, rows);
  }
}

function sendXlsx(res: Response, filename: string, headers: string[], data: (string | number)[][]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buf);
}

function sendCsv(res: Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

export function reportRoutes(store: Store): Router {
  const r = Router();

  // GET /reports/export?type=summary|individual|criterion|vertical&format=csv|xlsx
  r.get('/reports/export', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const type = typeof req.query.type === 'string' ? (req.query.type as ExportType) : 'summary';
      const format = typeof req.query.format === 'string' ? (req.query.format as ExportFormat) : 'csv';
      if (!EXPORT_TYPES.includes(type)) throw badRequest(`type must be one of: ${EXPORT_TYPES.join(', ')}`);
      if (!EXPORT_FORMATS.includes(format)) throw badRequest(`format must be one of: ${EXPORT_FORMATS.join(', ')}`);
      const parsed = candidateFiltersSchema.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten());
      const rows = await store.results({ admin: true }, { ...parsed.data, includeArchived: true });
      const report = await buildReport(store, type, rows);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      await store.audit({
        actor_id: req.user!.id,
        action: `export_${type}`,
        entity_type: 'export',
        entity_id: null,
        details: { type, format, rows: report.data.length },
      });
      if (format === 'xlsx') {
        sendXlsx(res, `gdgoc-${type}-${stamp}.xlsx`, report.headers, report.data);
      } else {
        sendCsv(res, `gdgoc-${type}-${stamp}.csv`, toCsv(report.headers, report.data));
      }
    } catch (e) {
      next(e);
    }
  });

  // Small JSON summary for the reports dashboard page.
  r.get('/reports/overview', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const rows = await store.results({ admin: true }, { includeArchived: false });
      const verticals = await store.listVerticals();
      const byVertical = new Map<string, { total: number; evaluated: number; provisional: number; scored: number[] }>();
      for (const v of verticals) byVertical.set(v.name, { total: 0, evaluated: 0, provisional: 0, scored: [] });
      for (const row of rows) {
        const key = row.vertical_name ?? 'Unassigned';
        const g = byVertical.get(key) ?? { total: 0, evaluated: 0, provisional: 0, scored: [] };
        g.total += 1;
        if (row.evaluation_count > 0) g.evaluated += 1;
        if (row.is_provisional) g.provisional += 1;
        if (row.average_score !== null) g.scored.push(Number(row.average_score));
        byVertical.set(key, g);
      }
      const allScores = rows.filter((r) => r.average_score !== null).map((r) => Number(r.average_score));
      res.json({
        totals: {
          applicants: rows.length,
          evaluated: rows.filter((r) => r.evaluation_count > 0).length,
          complete: rows.filter((r) => r.evaluation_count > 0 && !r.is_provisional).length,
          provisional: rows.filter((r) => r.is_provisional && r.evaluation_count > 0).length,
          shortlisted: rows.filter((r) => r.shortlisting_status === 'shortlisted').length,
          avg_of_averages: allScores.length ? displayScore(allScores.reduce((a, b) => a + b, 0) / allScores.length) : null,
        },
        by_vertical: [...byVertical.entries()].map(([name, g]) => ({
          vertical: name,
          applicants: g.total,
          evaluated: g.evaluated,
          provisional: g.provisional,
          avg_of_averages: g.scored.length
            ? displayScore(g.scored.reduce((a, b) => a + b, 0) / g.scored.length)
            : null,
        })),
        export_types: EXPORT_TYPES,
        export_formats: EXPORT_FORMATS,
      });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
