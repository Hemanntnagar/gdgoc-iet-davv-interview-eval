import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, HttpError, notFound, tooMany } from '../lib/errors.js';
import { AttemptTracker } from '../lib/attemptTracker.js';
import { hashPanelCode, safeEqualHex } from '../lib/hash.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { roleUpdateSchema } from '../lib/validate.js';
import type { AppConfig } from '../config.js';
import type { Store } from '../store/types.js';

function isAdmin(req: AuthedRequest) {
  if (req.user!.role !== 'admin') throw new HttpError(403, 'forbidden', 'Administrator access required');
}

const claimAttempts = new AttemptTracker();

export function adminRoutes(store: Store, config: AppConfig): Router {
  const r = Router();

  // Admin secret code: entered on the registration form (or any signed-in
  // account). Grants admin status. The code itself is never returned by any
  // endpoint; comparison is constant-time and rate-limited.
  r.post('/admin/claim', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z.object({ code: z.string().trim().min(1).max(200) }).safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const user = req.user!;
      if (user.role === 'admin') {
        res.json({ status: 'ok', already_admin: true });
        return;
      }
      if (!config.adminSecretCode) {
        throw new HttpError(503, 'not_configured', 'Admin secret code is not configured on this server');
      }
      const key = `claim:${user.id}`;
      if (!claimAttempts.allow(key, 5, 15 * 60_000)) {
        throw tooMany('Too many attempts. Try again later.');
      }
      const provided = hashPanelCode(parsed.data.code, config.codePepper);
      const expected = hashPanelCode(config.adminSecretCode, config.codePepper);
      if (!safeEqualHex(provided, expected)) {
        claimAttempts.fail(key, 15 * 60_000);
        throw new HttpError(401, 'invalid_code', 'Incorrect admin secret code');
      }
      claimAttempts.reset(key);
      const updated = await store.setProfileRole(user.id, 'admin');
      await store.audit({
        actor_id: user.id,
        action: 'admin_claimed',
        entity_type: 'profile',
        entity_id: user.id,
        details: {},
      });
      res.json({ status: 'ok', user: updated });
    } catch (e) {
      next(e);
    }
  });

  // List judge/admin accounts (metadata only — never credentials).
  r.get('/admin/users', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      isAdmin(req);
      const [users, panels, members] = await Promise.all([
        store.listProfiles(),
        store.listPanels(),
        store.listAllPanelMembers(),
      ]);
      const panelNames = new Map(panels.map((p) => [p.id, p.name] as const));
      const memberships = new Map<string, string[]>();
      for (const m of members) {
        const name = panelNames.get(m.panel_id);
        if (!name) continue;
        memberships.set(m.judge_id, [...(memberships.get(m.judge_id) ?? []), name]);
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
