import crypto from 'node:crypto';
import express, { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { logger } from './core/logger';
import { prisma } from './core/db';
import { runWithContext } from './core/context';
import { authRouter } from './core/auth/auth.routes';
import { authenticate } from './core/auth/auth.middleware';
import { errorHandler, notFoundHandler } from './core/errors/error-middleware';
import { settingsRouter } from './core/settings/settings.routes';
import { notifyRouter } from './core/notify/notify.routes';
import { moduleRouters } from './modules';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Nginx in production
  app.set('json replacer', (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? crypto.randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use((req, _res, next) => {
    runWithContext({ requestId: String(req.id), ip: req.ip, userAgent: req.get('user-agent') }, next);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/health/ready', async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'up' });
  });

  const v1 = Router();
  v1.use('/auth', authRouter);
  // Everything below requires a valid access token; each route adds requirePermission().
  v1.use(authenticate);
  v1.use(settingsRouter);
  v1.use(notifyRouter);
  for (const r of moduleRouters) v1.use(r);
  app.use('/api/v1', v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
