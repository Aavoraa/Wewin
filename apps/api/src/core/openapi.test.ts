import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../../test/helpers';

describe('OpenAPI document', () => {
  it('lists every module route with its permission, parameters and request body', async () => {
    const r = await request(app).get('/api/docs/openapi.json');
    expect(r.status).toBe(200);
    const doc = r.body;
    expect(doc.openapi).toBe('3.1.0');
    const paths = Object.keys(doc.paths);
    expect(paths.length).toBeGreaterThan(150);
    for (const p of ['/orders', '/orders/{id}/confirm', '/yarn-receipts/{id}/post', '/export-invoices', '/reports/run/{key}', '/attachments', '/auth/login']) expect(paths).toContain(p);
    const post = doc.paths['/orders/{id}/confirm'].post;
    expect(post.description).toContain('`orders.');
    expect(post.parameters).toEqual([expect.objectContaining({ name: 'id', in: 'path', required: true })]);
    expect(doc.paths['/orders'].post.requestBody.content['application/json'].schema.properties.orderNo).toBeDefined();
    expect(doc.paths['/orders'].get.parameters.map((p: { name: string }) => p.name)).toContain('page');
    expect(doc.paths['/auth/login'].post.security).toEqual([]);
    // Every route behind authentication declares a permission or is explicitly for any signed-in user.
    for (const [p, ops] of Object.entries(doc.paths as Record<string, Record<string, { description: string }>>)) {
      for (const op of Object.values(ops)) expect(op.description, p).toMatch(/^(Requires permission|Any signed-in user|Public)/);
    }
  });
  it('serves Swagger UI from the local package', async () => {
    const r = await request(app).get('/api/docs/');
    expect(r.status).toBe(200);
    expect(r.text).toContain('swagger-ui-bundle.js');
    expect((await request(app).get('/api/docs/swagger-ui-bundle.js')).status).toBe(200);
  });
});
