import { Router } from 'express';
import { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { syncSchema } from '../lib/validate.js';
import { handleSubmission } from '../services/submit.js';
import type { Store } from '../store/types.js';

export interface SyncItemResult {
  id: string;
  status: 'ok' | 'duplicate' | 'conflict' | 'error';
  idempotent?: boolean;
  message?: string;
  details?: Record<string, string>;
  evaluation?: unknown;
  existing?: unknown;
}

/**
 * Idempotent batch synchronization endpoint.
 * Re-sending the same evaluation (same client-generated UUID) never creates a
 * second official evaluation. Per-item results let the client keep successful
 * items and retry failures without losing data.
 */
export function syncRoutes(store: Store): Router {
  const r = Router();

  r.get('/sync/status', requireAuth, async (req: AuthedRequest, res) => {
    res.json({ server_time: new Date().toISOString(), user_id: req.user!.id });
  });

  r.post('/sync/evaluations', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      const parsed = syncSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const user = req.user!;
      const results: SyncItemResult[] = [];
      for (const item of parsed.data.evaluations) {
        const { replace_existing, ...input } = item;
        const outcome = await handleSubmission(store, user.id, input, {
          // Replacing an existing official evaluation is only honored when the
          // round's explicit edit policy allows it (checked inside the pipeline).
          replaceExisting: replace_existing ?? true,
        });
        switch (outcome.status) {
          case 'ok':
            results.push({
              id: item.id,
              status: 'ok',
              idempotent: outcome.idempotent,
              evaluation: outcome.evaluation,
            });
            break;
          case 'duplicate':
            results.push({
              id: item.id,
              status: 'conflict',
              message:
                'An official evaluation from you already exists for this candidate. ' +
                'The local copy was kept; resolve it from the sync screen.',
              existing: outcome.existing,
            });
            break;
          case 'conflict':
            results.push({ id: item.id, status: 'conflict', message: outcome.reason });
            break;
          default:
            results.push({
              id: item.id,
              status: 'error',
              message: outcome.message,
              details: outcome.details,
            });
        }
      }
      await store.audit({
        actor_id: user.id,
        action: 'evaluations_synced',
        entity_type: 'evaluation',
        entity_id: null,
        details: {
          submitted: results.filter((x) => x.status === 'ok').length,
          conflicts: results.filter((x) => x.status === 'conflict').length,
          errors: results.filter((x) => x.status === 'error').length,
        },
      });
      res.json({ results, server_time: new Date().toISOString() });
    } catch (e) {
      next(e);
    }
  });

  return r;
}

export const syncItemSchema = z.any();
