import { randomBytes } from 'node:crypto';

/**
 * Admin-side GoTrue (Supabase Auth) operations used for vertical-wise
 * interviewer account provisioning. Passwords are generated server-side,
 * returned to the admin exactly once, and never stored.
 */

export interface GoTrueAdminUser {
  id: string;
  email: string;
}

function adminBase(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/users`;
}

/** Supabase Auth rate-limits email-sending (even with email_confirm=true it
 *  returns "Email rate limit exceeded" under bursts). Retry with backoff. */
const RATE_LIMIT_RE = /rate limit|too many requests/i;
const DEFAULT_RETRY_AFTER_MS = 5_000;

function isRateLimited(status: number, msg: string): boolean {
  return status === 429 || RATE_LIMIT_RE.test(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Retries for transient failures; disabled under NODE_ENV=test so unit tests
 *  fail fast when Supabase Auth is unreachable. */
function defaultMaxRetries(): number {
  const env = process.env.GOTRUE_ADMIN_MAX_RETRIES;
  if (env !== undefined && env !== '') return Math.max(0, Number(env));
  return process.env.NODE_ENV === 'test' ? 0 : 4;
}

async function goTrueRequest(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
  maxRetries = defaultMaxRetries(),
): Promise<unknown> {
  let lastMsg = '';
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(path, {
        ...init,
        signal: ctrl.signal,
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      if (res.ok) return body;
      const msg =
        (body as { msg?: string; message?: string; error_description?: string } | null)?.msg ??
        (body as { message?: string } | null)?.message ??
        (body as { error_description?: string } | null)?.error_description ??
        text ??
        `HTTP ${res.status}`;
      lastMsg = msg;
      if (isRateLimited(res.status, msg) && attempt < maxRetries) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_RETRY_AFTER_MS * 2 ** attempt;
        await sleep(waitMs);
        continue;
      }
      throw new Error(`GoTrue admin error (${res.status}): ${msg}`);
    } catch (e) {
      // Network-level failures (e.g. transient fetch errors) also get retried.
      if (attempt < maxRetries && !(e instanceof Error && /GoTrue admin error/.test(e.message))) {
        await sleep(DEFAULT_RETRY_AFTER_MS * 2 ** attempt);
        continue;
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** 16-char unambiguous password (no look-alike characters). */
export function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%+=';
  const bytes = randomBytes(24);
  let out = '';
  for (let i = 0; i < 16; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/** Create (or reuse) the auth user for a provisioned interviewer. */
export async function createAuthUser(opts: {
  supabaseUrl: string;
  serviceRoleKey: string;
  timeoutMs: number;
  userId: string;
  email: string;
  password: string;
  displayName: string;
}): Promise<GoTrueAdminUser> {
  const body = await goTrueRequest(
    opts.supabaseUrl,
    opts.serviceRoleKey,
    adminBase(opts.supabaseUrl),
    {
      method: 'POST',
      body: JSON.stringify({
        id: opts.userId,
        email: opts.email,
        password: opts.password,
        email_confirm: true,
        user_metadata: { display_name: opts.displayName, provisioned: true },
      }),
    },
    opts.timeoutMs,
  );
  const b = body as { id?: string; email?: string };
  return { id: b?.id ?? opts.userId, email: b?.email ?? opts.email };
}

/** Reset an existing auth user's password (returned once to the admin). */
export async function resetAuthPassword(opts: {
  supabaseUrl: string;
  serviceRoleKey: string;
  timeoutMs: number;
  userId: string;
  password: string;
}): Promise<void> {
  await goTrueRequest(
    opts.supabaseUrl,
    opts.serviceRoleKey,
    `${adminBase(opts.supabaseUrl)}/${opts.userId}`,
    {
      method: 'PUT',
      body: JSON.stringify({ password: opts.password }),
    },
    opts.timeoutMs,
  );
}

/** Deactivate an auth user (invoked alongside profile deactivation). */
export async function deactivateAuthUser(opts: {
  supabaseUrl: string;
  serviceRoleKey: string;
  timeoutMs: number;
  userId: string;
}): Promise<void> {
  await goTrueRequest(
    opts.supabaseUrl,
    opts.serviceRoleKey,
    `${adminBase(opts.supabaseUrl)}/${opts.userId}`,
    {
      method: 'PUT',
      body: JSON.stringify({ ban_duration: '87600h' }),
    },
    opts.timeoutMs,
  );
}
