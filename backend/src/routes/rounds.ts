import { Router } from 'express';
import { z } from 'zod';
import { badRequest, HttpError } from '../lib/errors.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { criterionSchema, roundCreateSchema, roundPatchSchema, criterionPatchSchema } from '../lib/validate.js';
import { DEFAULT_CRITERIA, STAR_MAX, STAR_MIN } from '../lib/rubric.js';
import type { Store } from '../store/types.js';

function isAdmin(req: AuthedRequest) {
  if (req.user!.role !== 'admin') throw new HttpError(403, 'forbidden', 'Administrator access required');
}

export function roundRoutes(store: Store): Router {
  const r = Router();

  // Any authenticated user may read rounds and criteria (the rubric is not secret).
  r.get('/rounds', requireAuth, async (_req, res, next) => {
    try {
      res.json({ rounds: await store.listRounds() });
    } catch (e) {
      next(e);
    }
  });

  r.get('/rounds/:id/criteria', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      res.json({ criteria: await store.listCriteria(req.params.id) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/rounds', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const parsed = roundCreateSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const round = await store.createRound({ ...parsed.data, closes_at: parsed.data.closes_at ?? null });
      // Seed the five default 1–5 star criteria; admins may edit/remove them.
      if (parsed.data.seed_default_criteria !== false) {
        for (let i = 0; i < DEFAULT_CRITERIA.length; i++) {
          const c = DEFAULT_CRITERIA[i];
          await store.createCriterion({
            round_id: round.id,
            name: c.name,
            description: c.description,
            min_score: STAR_MIN,
            max_score: STAR_MAX,
            weight: 1,
            sort_order: i + 1,
            is_active: true,
          });
        }
      }
      await store.audit({
        actor_id: req.user!.id,
        action: 'round_created',
        entity_type: 'evaluation_round',
        entity_id: round.id,
        details: { name: round.name },
      });
      res.status(201).json({ round });
    } catch (e) {
      next(e);
    }
  });

  r.patch('/rounds/:id', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const parsed = roundPatchSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const round = await store.updateRound(req.params.id, parsed.data);
      if (!round) throw new HttpError(404, 'not_found', 'Round not found');
      await store.audit({
        actor_id: req.user!.id,
        action: 'round_updated',
        entity_type: 'evaluation_round',
        entity_id: round.id,
        details: parsed.data as Record<string, unknown>,
      });
      res.json({ round });
    } catch (e) {
      next(e);
    }
  });

  r.post('/rounds/:id/criteria', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const parsed = criterionSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      if (parsed.data.max_score <= parsed.data.min_score) {
        throw badRequest('max_score must be greater than min_score');
      }
      const round = await store.getRound(req.params.id);
      if (!round) throw new HttpError(404, 'not_found', 'Round not found');
      const criterion = await store.createCriterion({ ...parsed.data, round_id: round.id });
      await store.audit({
        actor_id: req.user!.id,
        action: 'criterion_created',
        entity_type: 'criterion',
        entity_id: criterion.id,
        details: { name: criterion.name },
      });
      res.status(201).json({ criterion });
    } catch (e) {
      next(e);
    }
  });

  r.patch('/criteria/:id', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const parsed = criterionPatchSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const criterion = await store.updateCriterion(req.params.id, parsed.data);
      if (!criterion) throw new HttpError(404, 'not_found', 'Criterion not found');
      await store.audit({
        actor_id: req.user!.id,
        action: 'criterion_updated',
        entity_type: 'criterion',
        entity_id: criterion.id,
        details: parsed.data as Record<string, unknown>,
      });
      res.json({ criterion });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
