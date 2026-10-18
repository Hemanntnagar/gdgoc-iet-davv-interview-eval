import { Router } from 'express';
import { scopeFor, type AuthedRequest } from '../lib/auth.js';
import type { Store } from '../store/types.js';

export function meRoutes(store: Store): Router {
  const r = Router();
  r.get('/me', async (req: AuthedRequest, res, next) => {
    try {
      const user = req.user!;
      const scope = await scopeFor(store, user);
      const panels = await store.listMyPanels(user.id);
      res.json({
        profile: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
        },
        panels,
        is_admin: scope.admin,
      });
    } catch (e) {
      next(e);
    }
  });
  return r;
}
