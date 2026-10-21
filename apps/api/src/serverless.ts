/**
 * Vercel entry (api/index.mjs re-exports this): the same Express app as main.ts, without a listening
 * server or pg-boss workers. Jobs run in-process after the response (kept alive with waitUntil);
 * scheduled jobs come from Vercel Cron (/api/cron/<job>). Defaults below suit Vercel and can be
 * overridden by the project's environment variables.
 */
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

process.env.TZ = 'Asia/Kolkata';
process.env.JOBS_ENABLED = 'false';
process.env.COOKIE_SECURE ??= 'true';
process.env.TRUST_PROXY_HOPS ??= '1';
if (!process.env.CORS_ORIGIN && process.env.VERCEL_PROJECT_PRODUCTION_URL) process.env.CORS_ORIGIN = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
// Token signing key: JWT_SECRET when set; otherwise derived from the database credentials Vercel
// stores for the connected Neon database (as secret as the database itself, stable across deploys;
// rotating the database password signs everyone out).
const dbSecret = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!process.env.JWT_SECRET && dbSecret) process.env.JWT_SECRET = createHmac('sha256', dbSecret).update('wewin-jwt-v1').digest('base64url');
// Neon's pooled address (PgBouncer, transaction mode) needs Prisma's pgbouncer mode.
if (process.env.DATABASE_URL && /-pooler\./.test(process.env.DATABASE_URL) && !/pgbouncer=true/.test(process.env.DATABASE_URL)) {
  process.env.DATABASE_URL += `${process.env.DATABASE_URL.includes('?') ? '&' : '?'}pgbouncer=true&connection_limit=5`;
}

type App = (req: never, res: never) => void;
let app: App | null = null;
let syncPermissions: (() => Promise<void>) | null = null;
let setupError: string | null = null;
try {
  const [a, p] = await Promise.all([import('./app'), import('./core/auth/permissions.sync'), import('./jobs/register')]);
  app = a.createApp() as unknown as App;
  syncPermissions = p.syncPermissions;
} catch (err) {
  // Most often a missing setting (DATABASE_URL, JWT_SECRET…): say which, instead of a bare 500.
  setupError = err instanceof Error ? err.message : String(err);
  console.error('Wewin API is not configured:', setupError);
}
let ready: Promise<void> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!app || !syncPermissions) {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'SERVER_NOT_CONFIGURED', message: `The server is not set up yet. ${setupError ?? ''}`.trim() } }));
    return;
  }
  const sync = syncPermissions;
  ready ??= sync().catch((err) => {
    ready = null;
    throw err;
  });
  await ready;
  return app(req as never, res as never);
}
