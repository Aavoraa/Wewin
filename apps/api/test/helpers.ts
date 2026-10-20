import crypto from 'node:crypto';
import request from 'supertest';
import argon2 from 'argon2';
import { expect } from 'vitest';
import { type PermissionKey } from '@wewin/shared';
import { createApp } from '../src/app';
import { prisma } from '../src/core/db';
import { runWithContext } from '../src/core/context';

export const app = createApp();

export function uid(prefix = 'T'): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

const PASSWORD = 'Test-password-123';

/** Create a user holding exactly the given permissions (or the OWNER role). */
export async function createUser(perms: PermissionKey[] | 'OWNER') {
  const username = uid('u').toLowerCase();
  let roleId: string;
  if (perms === 'OWNER') {
    roleId = (await prisma.role.findUniqueOrThrow({ where: { code: 'OWNER' } })).id;
  } else {
    const role = await prisma.role.create({
      data: {
        code: uid('ROLE'),
        name: 'Test role',
        permissions: { create: perms.map((permissionKey) => ({ permissionKey })) },
      },
    });
    roleId = role.id;
  }
  const user = await prisma.user.create({
    data: {
      username,
      fullName: `Test ${username}`,
      passwordHash: await argon2.hash(PASSWORD, { type: argon2.argon2id }),
      roles: { create: [{ roleId }] },
    },
  });
  return { id: user.id, username, password: PASSWORD };
}

export async function login(username: string, password: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  return res;
}

export interface Client {
  userId: string;
  token: string;
  get(url: string): request.Test;
  post(url: string, body?: object): request.Test;
  patch(url: string, body?: object): request.Test;
  put(url: string, body?: object): request.Test;
  del(url: string): request.Test;
}

/** Logged-in API client for a fresh user with the given permissions. */
export async function asUser(perms: PermissionKey[] | 'OWNER'): Promise<Client> {
  const u = await createUser(perms);
  const res = await login(u.username, u.password);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const token = res.body.data.accessToken as string;
  const auth = (t: request.Test) => t.set('authorization', `Bearer ${token}`);
  return {
    userId: u.id,
    token,
    get: (url) => auth(request(app).get(url)),
    post: (url, body = {}) => auth(request(app).post(url).send(body)),
    patch: (url, body = {}) => auth(request(app).patch(url).send(body)),
    put: (url, body = {}) => auth(request(app).put(url).send(body)),
    del: (url) => auth(request(app).delete(url)),
  };
}

/** Management approval of a draft outward D.C. — required before posting (Q-048). */
export async function approveOutward(c: Client, id: string) {
  const r = await c.post(`/api/v1/outward-dcs/${id}/approve`, { note: 'Approved for dispatch' });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data;
}

/** Run code as if inside a request by the given user (so withTx tags audit rows). */
export function asContext<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return runWithContext({ requestId: crypto.randomUUID(), userId }, fn);
}

export async function locationId(code: string): Promise<string> {
  return (await prisma.location.findUniqueOrThrow({ where: { code } })).id;
}

export async function makeItem(type: 'YARN' | 'FABRIC' | 'PANEL' | 'GARMENT' | 'TRIM' = 'YARN', unit: 'KG' | 'PCS' | 'NOS' = 'KG') {
  return prisma.item.create({ data: { code: uid(type.slice(0, 3)), name: `Test ${type}`, type, unit } });
}

export async function makeVendorLocation() {
  return prisma.location.create({ data: { code: uid('VND'), name: 'Test vendor', kind: 'VENDOR' } });
}

/**
 * Ledger invariants (A§13): no non-virtual location is negative at item+location+lot+colour+size,
 * every reversal points at a movement of the same source, and nothing is reversed twice.
 */
export async function assertLedgerInvariants(): Promise<void> {
  const negatives = await prisma.$queryRaw<unknown[]>`
    SELECT b.item_id, b.location_id, b.lot, b.colour, b.size, SUM(b.q) AS qty
    FROM (
      SELECT item_id, to_location_id AS location_id, lot, colour, size, qty AS q FROM stock_movements
      UNION ALL SELECT item_id, from_location_id, lot, colour, size, -qty FROM stock_movements
    ) b JOIN locations l ON l.id = b.location_id
    WHERE l.kind <> 'VIRTUAL'
    GROUP BY b.item_id, b.location_id, b.lot, b.colour, b.size
    HAVING SUM(b.q) < 0`;
  expect(negatives, 'negative stock at a non-virtual location').toEqual([]);
  const badReversals = await prisma.$queryRaw<unknown[]>`
    SELECT r.id FROM stock_movements r
    LEFT JOIN stock_movements o ON o.id = r.reversal_of_id
    WHERE r.is_reversal AND (o.id IS NULL OR o.source_id <> r.source_id OR o.qty <> r.qty
          OR o.from_location_id <> r.to_location_id OR o.to_location_id <> r.from_location_id)`;
  expect(badReversals, 'reversal rows must mirror their original').toEqual([]);
  const doubleReversed = await prisma.$queryRaw<unknown[]>`
    SELECT reversal_of_id FROM stock_movements WHERE reversal_of_id IS NOT NULL
    GROUP BY reversal_of_id HAVING COUNT(*) > 1`;
  expect(doubleReversed, 'a movement was reversed twice').toEqual([]);
}
