import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { AppConfig } from './config.js';
import { HttpError } from './lib/errors.js';
import { makeAuthMiddleware, type TokenVerifier } from './lib/auth.js';
import { meRoutes } from './routes/me.js';
import { panelRoutes } from './routes/panels.js';
import { candidateRoutes } from './routes/candidates.js';
import { roundRoutes } from './routes/rounds.js';
import { evaluationRoutes } from './routes/evaluations.js';
import { syncRoutes } from './routes/sync.js';
import { resultRoutes } from './routes/results.js';
import { adminRoutes } from './routes/admin.js';
import type { Store } from './store/types.js';

export interface AppDeps {
  store: Store;
  verifyToken: TokenVerifier;
  config: AppConfig;
}

export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  const configuredOrigin = deps.config.corsOrigin;
  const corsOrigin =
    typeof configuredOrigin === 'string' ? configuredOrigin : configuredOrigin.includes('*') ? '*' : configuredOrigin;
  app.use(
    cors({
      origin: corsOrigin,
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(express.json({ limit: '2mb' }));

  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60_000,
      limit: 500,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  const auth = makeAuthMiddleware(deps.store, deps.verifyToken);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api', auth, meRoutes(deps.store));
  app.use('/api', auth, panelRoutes(deps.store, deps.config));
  app.use('/api', auth, candidateRoutes(deps.store));
  app.use('/api', auth, roundRoutes(deps.store));
  app.use('/api', auth, evaluationRoutes(deps.store));
  app.use('/api', auth, syncRoutes(deps.store));
  app.use('/api', auth, resultRoutes(deps.store));
  app.use('/api', auth, adminRoutes(deps.store));

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Route not found' } });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        error: { code: 'validation_error', message: 'Invalid request', details: err.flatten() },
      });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
  });

  return app;
}
