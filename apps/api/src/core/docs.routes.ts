import { createRequire } from 'node:module';
import path from 'node:path';
import express, { Router } from 'express';
import { buildOpenApi } from './openapi';

/**
 * /api/docs — Swagger UI over the generated OpenAPI document (/api/docs/openapi.json). Served from the
 * local swagger-ui-dist package (no CDN), so it works offline and under the default Helmet CSP.
 */
export function docsRouter(mounts: Parameters<typeof buildOpenApi>[0]) {
  const r = Router();
  let spec: ReturnType<typeof buildOpenApi> | undefined;
  const uiDir = path.dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));

  r.get('/openapi.json', (_req, res) => {
    spec ??= buildOpenApi(mounts, { title: 'Wewin ERP API', version: process.env.npm_package_version ?? '0.1.0' });
    res.json(spec);
  });
  r.get('/init.js', (_req, res) => {
    res.type('application/javascript').send(
      "window.ui = SwaggerUIBundle({ url: 'openapi.json', dom_id: '#swagger-ui', deepLinking: true, persistAuthorization: false, tagsSorter: 'alpha', operationsSorter: 'alpha', presets: [SwaggerUIBundle.presets.apis] });",
    );
  });
  r.get('/', (req, res) => {
    // Relative asset URLs need the trailing slash.
    if (!req.originalUrl.split('?')[0]?.endsWith('/')) return res.redirect(301, `${req.baseUrl}/`);
    res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light"><title>Wewin ERP API</title><link rel="stylesheet" href="swagger-ui.css"><style>html,body{margin:0;background:#fff}</style></head>
<body><div id="swagger-ui"></div><script src="swagger-ui-bundle.js"></script><script src="init.js"></script></body></html>`);
  });
  r.use(express.static(uiDir, { index: false, maxAge: '1d' }));
  return r;
}
