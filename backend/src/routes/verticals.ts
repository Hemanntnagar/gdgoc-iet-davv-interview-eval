import { Router } from 'express';
import { z } from 'zod';
import { badRequest, HttpError, notFound } from '../lib/errors.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import type { Store } from '../store/types.js';

function isAdmin(req: AuthedRequest) {
  if (req.user!.role !== 'admin') throw new HttpError(403, 'forbidden', 'Administrator access required');
}

const verticalCreateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes only'),
  name: z.string().trim().min(1).max(80),
  worksheet: z.string().trim().max(120).nullable().optional(),
  sort_order: z.number().int().min(0).max(999).optional(),
});

const verticalPatchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  worksheet: z.string().trim().max(120).nullable().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(999).optional(),
});

export function verticalRoutes(store: Store): Router {
  const r = Router();

  // Authenticated users see active verticals (sidebar + filters).
  r.get('/verticals', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      const onlyActive = req.user!.role !== 'admin';
      res.json({ verticals: await store.listVerticals(onlyActive) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/verticals', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const parsed = verticalCreateSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const vertical = await store.createVertical(parsed.data);
      await store.audit({
        actor_id: req.user!.id,
        action: 'vertical_created',
        entity_type: 'vertical',
        entity_id: vertical.id,
        details: { key: vertical.key, name: vertical.name },
      });
      res.status(201).json({ vertical });
    } catch (e) {
      next(e);
    }
  });

  r.patch('/verticals/:id', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const parsed = verticalPatchSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const vertical = await store.updateVertical(req.params.id, parsed.data);
      if (!vertical) throw notFound('Vertical not found');
      await store.audit({
        actor_id: req.user!.id,
        action: 'vertical_updated',
        entity_type: 'vertical',
        entity_id: vertical.id,
        details: parsed.data as Record<string, unknown>,
      });
      res.json({ vertical });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
