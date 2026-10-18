import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { TokenVerifier } from './auth.js';

/**
 * Verifies Supabase Auth JWTs using the project's JWKS endpoint.
 * The role is NOT taken from JWT claims — it is loaded from the profiles
 * table on every request (see makeAuthMiddleware).
 */
export function makeSupabaseTokenVerifier(supabaseUrl: string): TokenVerifier {
  const issuer = `${supabaseUrl.replace(/\/$/, '')}/auth/v1`;
  const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
    cooldownDuration: 30_000,
    cacheMaxAge: 10 * 60_000,
  });
  return async (token: string): Promise<string | null> => {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: 'authenticated' });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  };
}
