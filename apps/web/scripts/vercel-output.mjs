/**
 * Vercel (Build Output API v3): serve the React build and forward /api to the Wewin API, which is
 * hosted elsewhere (docs/DEPLOYMENT.md). The API address comes from the API_ORIGIN environment
 * variable of the Vercel project (e.g. https://api.erp.example.in), so it can change without a
 * code change. Without it, /api answers 503 "API not configured" instead of failing silently.
 *
 * Run after `vite build`, from the repository root: node apps/web/scripts/vercel-output.mjs
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const dist = path.resolve(here, '../dist');
const out = path.join(root, '.vercel', 'output');

const raw = (process.env.API_ORIGIN ?? '').trim().replace(/\/+$/, '');
let apiOrigin = '';
if (raw) {
  const u = new URL(raw);
  if (u.protocol !== 'https:') throw new Error(`API_ORIGIN must be an https:// address (got ${u.protocol})`);
  if (u.pathname !== '/' || u.search || u.hash) throw new Error('API_ORIGIN must be just the origin, e.g. https://api.example.in');
  apiOrigin = u.origin;
}

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'static'), { recursive: true });
// Source maps stay out of the public deployment.
await cp(dist, path.join(out, 'static'), { recursive: true, filter: (src) => !src.endsWith('.map') });
await writeFile(
  path.join(out, 'static', 'api-not-configured.json'),
  JSON.stringify({ error: { code: 'API_NOT_CONFIGURED', message: 'The Wewin API address is not set. Add API_ORIGIN in the Vercel project settings and redeploy.' } }),
);

const security = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'strict-transport-security': 'max-age=31536000',
};
const routes = [
  { src: '^/(.*)$', headers: security, continue: true },
  apiOrigin
    ? { src: '^/api/(.*)$', dest: `${apiOrigin}/api/$1` }
    : { src: '^/api/(.*)$', dest: '/api-not-configured.json', status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
  { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
  { handle: 'filesystem' },
  // Client-side routes (/orders/123, /print/…) all load the app; index.html is never cached.
  { src: '^/(.*)$', dest: '/index.html', headers: { 'cache-control': 'no-cache' } },
];
await writeFile(path.join(out, 'config.json'), JSON.stringify({ version: 3, routes }, null, 2));
console.log(`Vercel output written to ${path.relative(root, out)}; /api → ${apiOrigin || 'not configured (503)'}`);
