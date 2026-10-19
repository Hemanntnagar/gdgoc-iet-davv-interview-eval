import { Router } from 'express';
import { z } from 'zod';
import { badRequest, HttpError, tooMany } from '../lib/errors.js';
import { AttemptTracker } from '../lib/attemptTracker.js';
import { hashPanelCode, safeEqualHex } from '../lib/hash.js';
import { requireAuth, type AuthedRequest } from '../lib/auth.js';
import { deleteAuthUser } from '../lib/gotrue.js';
import type { AppConfig } from '../config.js';
import type { Store } from '../store/types.js';

const completionAttempts = new AttemptTracker();

/**
 * Registration gate. The frontend signs the user up through Supabase, then
 * calls this endpoint with the code from the registration form:
 *
 *   - valid panel code  → judge, member of that panel
 *   - admin secret code → administrator
 *   - anything else     → the just-created account is destroyed
 *
 * This guarantees only invited people can hold an account, while a single
 * unmarked code field serves both judges and admins.
 */
export function registrationRoutes(store: Store, config: AppConfig): Router {
  const r = Router();

  r.post('/auth/complete-registration', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      const parsed = z.object({ code: z.string().trim().min(1).max(200) }).safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const user = req.user!;
      const key = `complete:${user.id}`;
      if (!completionAttempts.allow(key, 5, 15 * 60_000)) {
        throw tooMany('Too many attempts. Try again later.');
      }
      const code = parsed.data.code;

      // Admin secret — constant-time, rate-limited, never echoed back.
      if (config.adminSecretCode) {
        const provided = hashPanelCode(code, config.codePepper);
        const expected = hashPanelCode(config.adminSecretCode, config.codePepper);
        if (safeEqualHex(provided, expected)) {
          completionAttempts.reset(key);
          await store.setProfileRole(user.id, 'admin');
          await store.audit({
            actor_id: user.id,
            action: 'admin_claimed',
            entity_type: 'profile',
            entity_id: user.id,
            details: {},
          });
          res.json({ status: 'ok', role: 'admin' });
          return;
        }
      }

      // Panel code — same verification path as /panels/verify (attempt
      // counting and lockout included).
      const outcome = await store.verifyPanelCode({
        code_hash: hashPanelCode(code.toUpperCase(), config.codePepper),
        judge_id: user.id,
        lockout_minutes: config.verifyLockoutMinutes,
      });
      if (outcome.status === 'ok') {
        completionAttempts.reset(key);
        await store.audit({
          actor_id: user.id,
          action: 'panel_verified',
          entity_type: 'panel',
          entity_id: outcome.panel.id,
          details: { via: 'registration' },
        });
        res.json({ status: 'ok', role: 'judge', panel: outcome.panel });
        return;
      }
      if (outcome.status === 'locked') {
        // Keep the account: the judge can retry after the lockout expires.
        res.status(429).json({
          status: 'locked',
          message: 'Too many incorrect attempts. Try again later.',
          retry_at: outcome.retry_at,
        });
        return;
      }

      // Invalid code (or inactive panel) — the account must not survive,
      // otherwise anyone could squat emails. Best-effort on the auth side;
      // the profile row is always removed so /me fails and the session dies.
      completionAttempts.fail(key, 15 * 60_000);
      await store.deleteProfile(user.id).catch(() => {});
      await deleteAuthUser(config.supabaseUrl, config.serviceRoleKey, user.id).catch(() => {});
      res.status(401).json({ status: 'invalid', message: 'Invalid code.' });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
