import { Router } from 'express';
import { badRequest, HttpError } from '../lib/errors.js';
import { toCsv } from '../lib/csv.js';
import { requireAuth, scopeFor, type AuthedRequest } from '../lib/auth.js';
import { candidateFiltersSchema } from '../lib/validate.js';
import type { Store } from '../store/types.js';

function isAdmin(req: AuthedRequest) {
  if (req.user!.role !== 'admin') throw new HttpError(403, 'forbidden', 'Administrator access required');
}

export function resultRoutes(store: Store): Router {
  const r = Router();

  // Searchable results table — judges see only their panels; admins see all.
  r.get('/results', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      const parsed = candidateFiltersSchema.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten());
      const scope = await scopeFor(store, req.user!);
      const rows = await store.results(scope, parsed.data);
      res.json({ results: rows, count: rows.length });
    } catch (e) {
      next(e);
    }
  });

  // Summary export: averages + counts (admin only).
  r.get('/export/summary.csv', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const parsed = candidateFiltersSchema.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten());
      const rows = await store.results({ admin: true }, parsed.data);
      const csv = toCsv(
        [
          'candidate_id',
          'full_name',
          'branch',
          'application_id',
          'panel',
          'average_score',
          'evaluation_count',
          'expected_evaluations',
          'evaluation_status',
          'interview_status',
          'shortlisting_status',
        ],
        rows.map((x) => [
          x.candidate_id,
          x.full_name,
          x.branch,
          x.application_id ?? '',
          x.panel_name,
          x.average_score ?? '',
          x.evaluation_count,
          x.expected_evaluations,
          x.evaluation_status,
          x.interview_status,
          x.shortlisting_status,
        ]),
      );
      await store.audit({
        actor_id: req.user!.id,
        action: 'export_summary',
        entity_type: 'export',
        entity_id: null,
        details: { rows: rows.length },
      });
      sendCsv(res, 'results-summary.csv', csv);
    } catch (e) {
      next(e);
    }
  });

  // Detailed export: individual ratings + written feedback (admin only).
  r.get('/export/detailed.csv', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const parsed = candidateFiltersSchema.safeParse(req.query);
      if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten());
      const rows = await store.results({ admin: true }, { ...parsed.data, includeArchived: true });
      const criteriaCache = new Map<string, string>();
      const out: (string | number)[][] = [];
      for (const row of rows) {
        const evaluations = await store.listEvaluations({
          admin: true,
          candidateId: row.candidate_id,
        });
        for (const e of evaluations) {
          const scoreParts: string[] = [];
          for (const s of e.scores) {
            let name = criteriaCache.get(s.criterion_id);
            if (!name) {
              const roundCriteria = await store.listCriteria(e.round_id);
              name = roundCriteria.find((c) => c.id === s.criterion_id)?.name ?? s.criterion_id;
              criteriaCache.set(s.criterion_id, name);
            }
            scoreParts.push(`${name}=${s.score}`);
          }
          out.push([
            row.candidate_id,
            row.full_name,
            row.branch,
            row.panel_name,
            e.round_name ?? e.round_id,
            e.judge_name ?? e.judge_id,
            e.overall_score ?? '',
            scoreParts.join('; '),
            e.feedback,
            e.status,
            e.version,
            e.submitted_at,
          ]);
        }
        if (evaluations.length === 0) {
          out.push([row.candidate_id, row.full_name, row.branch, row.panel_name, '', '', '', '', 'NO EVALUATIONS', '', '', '']);
        }
      }
      const csv = toCsv(
        [
          'candidate_id',
          'candidate_name',
          'branch',
          'panel',
          'round',
          'judge',
          'overall_score',
          'criterion_scores',
          'feedback',
          'status',
          'version',
          'submitted_at',
        ],
        out,
      );
      await store.audit({
        actor_id: req.user!.id,
        action: 'export_detailed',
        entity_type: 'export',
        entity_id: null,
        details: { rows: out.length },
      });
      sendCsv(res, 'results-detailed.csv', csv);
    } catch (e) {
      next(e);
    }
  });

  return r;
}

function sendCsv(res: import('express').Response, filename: string, csv: string) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}
