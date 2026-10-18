import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from './errors.js';
import type { Profile, Store } from '../store/types.js';

export interface AuthedRequest extends Request {
  user?: Profile;
}

export type TokenVerifier = (token: string) => Promise<string | null>;

export function makeAuthMiddleware(store: Store, verifyToken: TokenVerifier) {
  return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) return next(unauthorized());
      const userId = await verifyToken(token);
      if (!userId) return next(unauthorized('Invalid or expired token'));
      const profile = await store.getProfile(userId);
      if (!profile || !profile.is_active) {
        return next(unauthorized('Account not found or deactivated'));
      }
      req.user = profile;
      next();
    } catch {
      next(unauthorized('Token verification failed'));
    }
  };
}

export function requireAuth(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req: AuthedRequest, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Administrator access required'));
  next();
}

/** Scope for data access: admins see everything; judges only their panels. */
export async function scopeFor(store: Store, user: Profile) {
  if (user.role === 'admin') return { admin: true as const, panelIds: [] as string[] };
  const panels = await store.listMyPanels(user.id);
  return { admin: false as const, judgeId: user.id, panelIds: panels.map((p) => p.id) };
}
