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

async function goTrueRequest(
  supabaseUrl: string,
  serviceRoleKey: string,
  path: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<unknown> {
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
    if (!res.ok) {
      const msg =
        (body as { msg?: string; message?: string; error_description?: string } | null)?.msg ??
        (body as { message?: string } | null)?.message ??
        (body as { error_description?: string } | null)?.error_description ??
        text ??
        `HTTP ${res.status}`;
      throw new Error(`GoTrue admin error (${res.status}): ${msg}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
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
