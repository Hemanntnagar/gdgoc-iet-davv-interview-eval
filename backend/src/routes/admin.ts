import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { roleUpdateSchema } from '../lib/validate.js';
import type { Store } from '../store/types.js';

function isAdmin(req: AuthedRequest) {
  if (req.user!.role !== 'admin') throw new HttpError(403, 'forbidden', 'Administrator access required');
}

export function adminRoutes(store: Store): Router {
  const r = Router();

  // List judge/admin accounts (metadata only — never credentials).
  r.get('/admin/users', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const users = await store.listProfiles();
      const panels = await store.listPanels();
      const memberships = new Map<string, string[]>();
      for (const p of panels) {
        const members = await store.listPanelMembers(p.id);
        for (const m of members) {
          memberships.set(m.judge_id, [...(memberships.get(m.judge_id) ?? []), p.name]);
        }
      }
      res.json({
        users: users.map((u) => ({ ...u, panels: memberships.get(u.id) ?? [] })),
      });
    } catch (e) {
      next(e);
    }
  });

  // Change a user's role. Guard: the last active admin cannot demote themselves.
  r.patch('/admin/users/:id/role', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const parsed = roleUpdateSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const target = await store.getProfile(req.params.id);
      if (!target) throw notFound('User not found');
      if (target.role === 'admin' && parsed.data.role === 'judge') {
        const admins = (await store.listProfiles('admin')).filter((a) => a.is_active);
        if (admins.length <= 1) {
          throw conflict('Cannot demote the last active administrator', 'last_admin');
        }
      }
      const updated = await store.setProfileRole(target.id, parsed.data.role);
      await store.audit({
        actor_id: req.user!.id,
        action: 'role_changed',
        entity_type: 'profile',
        entity_id: target.id,
        details: { from: target.role, to: parsed.data.role },
      });
      res.json({ user: updated });
    } catch (e) {
      next(e);
    }
  });

  // Activate / deactivate an account (e.g. revoke a judge's access).
  r.patch('/admin/users/:id/active', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const parsed = z.object({ is_active: z.boolean() }).safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const target = await store.getProfile(req.params.id);
      if (!target) throw notFound('User not found');
      if (!parsed.data.is_active && target.role === 'admin') {
        const admins = (await store.listProfiles('admin')).filter((a) => a.is_active);
        if (admins.length <= 1) {
          throw conflict('Cannot deactivate the last active administrator', 'last_admin');
        }
      }
      const updated = await store.setProfileActive(target.id, parsed.data.is_active);
      await store.audit({
        actor_id: req.user!.id,
        action: parsed.data.is_active ? 'user_activated' : 'user_deactivated',
        entity_type: 'profile',
        entity_id: target.id,
        details: {},
      });
      res.json({ user: updated });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
