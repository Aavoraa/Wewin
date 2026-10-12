import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import argon2 from 'argon2';
import { env } from '../../config/env';

const ISSUER = 'wewin-erp';
const AUDIENCE = 'wewin-web';

export interface AccessClaims {
  sub: string;
  sid: string;
}

export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sid: sessionId }, env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: userId,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.ACCESS_TOKEN_TTL_SEC,
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const p = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
    audience: AUDIENCE,
  }) as jwt.JwtPayload;
  if (typeof p.sub !== 'string' || typeof p.sid !== 'string') throw new Error('bad token claims');
  return { sub: p.sub, sid: p.sid };
}

/** Opaque refresh token; only its SHA-256 hash is stored. */
export function newRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Used when the username does not exist, so response time does not reveal valid usernames. */
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= argon2.hash('dummy-password-for-timing', { type: argon2.argon2id });
  return dummyHash;
}

export const REFRESH_COOKIE = 'wewin_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
