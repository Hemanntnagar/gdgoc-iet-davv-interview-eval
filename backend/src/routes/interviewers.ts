import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { badRequest, conflict, HttpError, notFound } from '../lib/errors.js';
import { requireAdmin, requireAuth, type AuthedRequest } from '../lib/auth.js';
import {
  createAuthUser,
  deactivateAuthUser,
  generatePassword,
  resetAuthPassword,
} from '../services/gotrue-admin.js';
import type { AppConfig } from '../config.js';
import type { Store } from '../store/types.js';

/**
 * Vertical-wise interviewer account provisioning.
 *
 * Login IDs follow the panel convention (e.g. "Panel 1.1"); the auth email is
 * `${login_id}@${domain}` where the domain may be supplied per request (any
 * domain is accepted) and falls back to LOGIN_EMAIL_DOMAIN. Alternatively the
 * admin may supply a full email address (any domain) which is used verbatim.
 * The generated password is returned to the admin exactly once and never
 * stored server-side.
 */

const loginIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[A-Za-z0-9@][A-Za-z0-9 ._@+-]*$/, 'letters, digits, spaces, dot, dash, underscore, @ only');

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'must be a valid email address (any domain)');

// Any domain is allowed — no allowlist.
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'must be a valid domain');

const provisionSchema = z.object({
  login_id: loginIdSchema,
  display_name: z.string().trim().min(1).max(120),
  vertical_ids: z.array(z.string().uuid()).min(1).max(20),
  panel_ids: z.array(z.string().uuid()).max(50).default([]),
  shift_restrictions: z.array(z.string().trim().max(40)).max(10).default([]),
  // Optional overrides — any domain is accepted.
  email: emailSchema.optional(),
  domain: domainSchema.optional(),
});

const bulkProvisionSchema = z.object({
  vertical_id: z.string().uuid(),
  count: z.number().int().min(1).max(50),
  name_prefix: z.string().trim().min(1).max(40).default('Panel'),
  panel_ids: z.array(z.string().uuid()).max(50).default([]),
  // Any domain is accepted; defaults to LOGIN_EMAIL_DOMAIN.
  domain: domainSchema.optional(),
});

const updateSchema = z.object({
  display_name: z.string().trim().min(1).max(120).optional(),
  vertical_ids: z.array(z.string().uuid()).min(1).max(20).optional(),
  panel_ids: z.array(z.string().uuid()).max(50).optional(),
  shift_restrictions: z.array(z.string().trim().max(40)).max(10).optional(),
  is_active: z.boolean().optional(),
});

function normalizeLoginId(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Build the auth email: explicit full email wins; a login_id that already
 *  contains "@" is used as-is (any domain); otherwise local part + domain. */
function buildEmail(
  loginId: string,
  opts: { email?: string; domain?: string },
  fallbackDomain: string,
): string {
  if (opts.email) return opts.email;
  const trimmed = loginId.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  const local = trimmed.replace(/[\s.]+/g, '').toLowerCase();
  return `${local}@${(opts.domain ?? fallbackDomain).toLowerCase()}`;
}

export function interviewerRoutes(store: Store, config: AppConfig): Router {
  const r = Router();

  const authAdmin = (req: AuthedRequest) => {
    if (req.user!.role !== 'admin') throw new HttpError(403, 'forbidden', 'Administrator access required');
  };

  // All interviewers (metadata only — never passwords).
  r.get('/admin/interviewers', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      authAdmin(req);
      const users = (await store.listProfiles('judge')).map((u) => ({
        id: u.id,
        email: u.email,
        login_id: u.login_id ?? '',
        display_name: u.display_name ?? u.full_name,
        vertical_ids: u.vertical_ids ?? [],
        panel_ids: u.panel_ids ?? [],
        shift_restrictions: u.shift_restrictions ?? [],
        is_active: u.is_active,
        created_at: u.created_at,
        password_reset_at: u.password_reset_at ?? null,
      }));
      res.json({ interviewers: users });
    } catch (e) {
      next(e);
    }
  });

  // Provision one interviewer.
  r.post('/admin/interviewers', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      authAdmin(req);
      const parsed = provisionSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const loginId = normalizeLoginId(parsed.data.login_id);
      if (await store.getProfileByLoginId(loginId)) {
        throw conflict(`Login ID "${loginId}" is already in use`, 'login_id_taken');
      }
      const email = buildEmail(loginId, parsed.data, config.loginEmailDomain);
      const userId = randomUUID();
      const password = generatePassword();
      // Auth user first — if GoTrue fails we never leave an orphan profile.
      try {
        await createAuthUser({
          supabaseUrl: config.supabaseUrl,
          serviceRoleKey: config.serviceRoleKey,
          timeoutMs: config.goTrueAdminTimeoutMs,
          userId,
          email,
          password,
          displayName: parsed.data.display_name,
        });
      } catch (e) {
        const msg = String((e as Error).message ?? e);
        if (/already.*(registered|exists)|422|400/i.test(msg)) {
          throw conflict('A Supabase auth user with this email already exists', 'email_taken');
        }
        throw e;
      }
      try {
        await store.provisionInterviewer({
          id: userId,
          login_id: loginId,
          email,
          display_name: parsed.data.display_name,
          vertical_ids: parsed.data.vertical_ids,
          panel_ids: parsed.data.panel_ids,
          shift_restrictions: parsed.data.shift_restrictions,
          created_by: req.user!.id,
        });
      } catch (e) {
        // Roll back the auth user so a retry is possible.
        try {
          await deactivateAuthUser({
            supabaseUrl: config.supabaseUrl,
            serviceRoleKey: config.serviceRoleKey,
            timeoutMs: config.goTrueAdminTimeoutMs,
            userId,
          });
        } catch {
          /* best effort */
        }
        throw e;
      }
      await store.audit({
        actor_id: req.user!.id,
        action: 'interviewer_provisioned',
        entity_type: 'profile',
        entity_id: userId,
        details: { login_id: loginId, vertical_ids: parsed.data.vertical_ids },
      });
      res.status(201).json({
        interviewer: {
          id: userId,
          login_id: loginId,
          email,
          display_name: parsed.data.display_name,
          vertical_ids: parsed.data.vertical_ids,
          panel_ids: parsed.data.panel_ids,
          shift_restrictions: parsed.data.shift_restrictions,
          is_active: true,
        },
        // Returned exactly once — never retrievable again.
        credentials: { login_id: loginId, email, password },
      });
    } catch (e) {
      next(e);
    }
  });

  // Bulk-provision N interviewers for a vertical with sequential login IDs
  // matching its panels (Panel 1.1, Panel 1.2, ... falling back to Panel 1.N).
  r.post('/admin/interviewers/bulk', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      authAdmin(req);
      const parsed = bulkProvisionSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const vertical = await store.getVertical(parsed.data.vertical_id);
      if (!vertical) throw notFound('Vertical not found');
      const panels = (await store.listPanels())
        .filter((p) => p.is_active)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const credentials: { login_id: string; email: string; password: string }[] = [];
      const created: { id: string; login_id: string; email: string }[] = [];
      const errors: { index: number; reason: string }[] = [];

      const verticalPanels = panels.filter(
        (p) => !p.vertical_id || p.vertical_id === vertical.id,
      );
      for (let i = 0; i < parsed.data.count; i++) {
        const panel = verticalPanels[i % Math.max(verticalPanels.length, 1)];
        const loginId = panel ? `${panel.name}` : `${parsed.data.name_prefix} ${i + 1}`;
        const uniqueLogin = panel ? loginId : `${loginId}`;
        try {
          if (await store.getProfileByLoginId(normalizeLoginId(uniqueLogin))) {
            errors.push({ index: i, reason: `login_id "${uniqueLogin}" already exists` });
            continue;
          }
          const email = buildEmail(uniqueLogin, parsed.data, config.loginEmailDomain);
          const userId = randomUUID();
          const password = generatePassword();
          await createAuthUser({
            supabaseUrl: config.supabaseUrl,
            serviceRoleKey: config.serviceRoleKey,
            timeoutMs: config.goTrueAdminTimeoutMs,
            userId,
            email,
            password,
            displayName: `${vertical.name} ${uniqueLogin}`,
          });
          await store.provisionInterviewer({
            id: userId,
            login_id: normalizeLoginId(uniqueLogin),
            email,
            display_name: `${vertical.name} ${uniqueLogin}`,
            vertical_ids: [vertical.id],
            panel_ids: panel ? [panel.id] : parsed.data.panel_ids,
            shift_restrictions: [],
            created_by: req.user!.id,
          });
          credentials.push({ login_id: normalizeLoginId(uniqueLogin), email, password });
          created.push({ id: userId, login_id: normalizeLoginId(uniqueLogin), email });
          // Pace creations to stay under Supabase Auth's email rate limit.
          await new Promise((r) => setTimeout(r, 1_200));
        } catch (e) {
          errors.push({ index: i, reason: String((e as Error).message ?? e) });
        }
      }
      await store.audit({
        actor_id: req.user!.id,
        action: 'interviewers_bulk_provisioned',
        entity_type: 'vertical',
        entity_id: vertical.id,
        details: { requested: parsed.data.count, created: created.length, failed: errors.length },
      });
      res.status(201).json({ created, credentials, errors });
    } catch (e) {
      next(e);
    }
  });

  // Update assignment metadata (not credentials).
  r.patch('/admin/interviewers/:id', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      authAdmin(req);
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest('Invalid request', parsed.error.flatten());
      const target = await store.getProfile(req.params.id);
      if (!target) throw notFound('Interviewer not found');
      const updated = await store.updateInterviewer(target.id, parsed.data);
      await store.audit({
        actor_id: req.user!.id,
        action: 'interviewer_updated',
        entity_type: 'profile',
        entity_id: target.id,
        details: parsed.data as Record<string, unknown>,
      });
      res.json({ interviewer: updated });
    } catch (e) {
      next(e);
    }
  });

  // Issue a new one-time password.
  r.post('/admin/interviewers/:id/reset-password', requireAuth, async (req: AuthedRequest, res, next) => {
    try {
      authAdmin(req);
      const target = await store.getProfile(req.params.id);
      if (!target) throw notFound('Interviewer not found');
      const password = generatePassword();
      await resetAuthPassword({
        supabaseUrl: config.supabaseUrl,
        serviceRoleKey: config.serviceRoleKey,
        timeoutMs: config.goTrueAdminTimeoutMs,
        userId: target.id,
        password,
      });
      await store.recordPasswordReset(target.id);
      await store.audit({
        actor_id: req.user!.id,
        action: 'interviewer_password_reset',
        entity_type: 'profile',
        entity_id: target.id,
        details: {},
      });
      res.json({ credentials: { login_id: target.login_id ?? '', email: target.email, password } });
    } catch (e) {
      next(e);
    }
  });

  return r;
}
