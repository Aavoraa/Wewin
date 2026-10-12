import crypto from 'node:crypto';
import { type MeResponse } from '@wewin/shared';
import { env } from '../../config/env';
import { withTx } from '../db';
import { AppError } from '../errors/app-error';
import { authRepo } from './auth.repo';
import {
  getDummyHash,
  hashPassword,
  hashToken,
  newRefreshToken,
  signAccessToken,
  verifyPassword,
} from './tokens';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
/** A refresh token rotated less than this long ago is treated as a benign race (two tabs), not reuse. */
const ROTATION_GRACE_MS = 10_000;

interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  userId: string;
}

const invalidCredentials = () => new AppError('INVALID_CREDENTIALS', 'Invalid username or password', 401);

function refreshExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
}

/** Pure lockout rule, unit-tested. */
export function nextLockState(failedCount: number, now: Date): { failedCount: number; lockedUntil: Date | null } {
  const n = failedCount + 1;
  if (n >= MAX_FAILED_LOGINS) {
    return { failedCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000) };
  }
  return { failedCount: n, lockedUntil: null };
}

export const authService = {
  async login(usernameRaw: string, password: string, client: ClientInfo): Promise<IssuedTokens> {
    const username = usernameRaw.trim().toLowerCase();
    // Failed attempts are committed (not rolled back) so lockout counts survive the 401.
    const outcome = await withTx(
      async (tx) => {
        const user = await authRepo.findUserByUsername(tx, username);
        if (!user) {
          await verifyPassword(await getDummyHash(), password);
          await authRepo.logLoginEvent(tx, { username, success: false, reason: 'UNKNOWN_USER', ...client });
          return { ok: false as const, error: invalidCredentials() };
        }
        // Attribute this transaction's audit rows (failed count, last login) to the user.
        await tx.$queryRaw`SELECT set_config('app.user_id', ${user.id}, true)`;
        const now = new Date();
        if (user.lockedUntil && user.lockedUntil > now) {
          await authRepo.logLoginEvent(tx, { username, userId: user.id, success: false, reason: 'LOCKED', ...client });
          const mins = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
          return {
            ok: false as const,
            error: new AppError('ACCOUNT_LOCKED', `Account locked after repeated failures. Try again in ${mins} minute(s).`, 423),
          };
        }
        if (!user.isActive) {
          await authRepo.logLoginEvent(tx, { username, userId: user.id, success: false, reason: 'INACTIVE', ...client });
          return { ok: false as const, error: invalidCredentials() };
        }
        const valid = await verifyPassword(user.passwordHash, password);
        if (!valid) {
          const next = nextLockState(user.failedLoginCount, now);
          await authRepo.recordFailedLogin(tx, user.id, next.failedCount, next.lockedUntil);
          await authRepo.logLoginEvent(tx, {
            username,
            userId: user.id,
            success: false,
            reason: next.lockedUntil ? 'BAD_PASSWORD_LOCKED' : 'BAD_PASSWORD',
            ...client,
          });
          return { ok: false as const, error: invalidCredentials() };
        }
        await authRepo.recordSuccessfulLogin(tx, user.id);
        await authRepo.logLoginEvent(tx, { username, userId: user.id, success: true, ...client });
        const { token, hash } = newRefreshToken();
        const expiresAt = refreshExpiry();
        const session = await authRepo.createSession(tx, {
          userId: user.id,
          familyId: crypto.randomUUID(),
          tokenHash: hash,
          expiresAt,
          ...client,
        });
        return {
          ok: true as const,
          tokens: {
            accessToken: signAccessToken(user.id, session.id),
            refreshToken: token,
            refreshExpiresAt: expiresAt,
            userId: user.id,
          },
        };
      },
      { isolation: 'ReadCommitted' },
    );
    if (!outcome.ok) throw outcome.error;
    return outcome.tokens;
  },

  /** Rotate the refresh token. Reuse of an already-rotated token revokes the whole session family. */
  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<IssuedTokens> {
    if (!refreshToken) throw new AppError('UNAUTHENTICATED', 'No session', 401);
    const outcome = await withTx(
      async (tx) => {
        const session = await authRepo.findSessionByHash(tx, hashToken(refreshToken));
        if (!session) return { ok: false as const, reason: 'Session not found' };
        const now = Date.now();
        if (session.revokedAt) {
          const benignRace =
            session.revokeReason === 'ROTATED' && now - session.revokedAt.getTime() < ROTATION_GRACE_MS;
          if (!benignRace) await authRepo.revokeFamily(tx, session.familyId, 'REUSE_DETECTED');
          return { ok: false as const, reason: 'Session expired' };
        }
        if (session.expiresAt.getTime() <= now) return { ok: false as const, reason: 'Session expired' };
        const access = await authRepo.findUserAccess(session.userId);
        if (!access?.isActive) {
          await authRepo.revokeFamily(tx, session.familyId, 'USER_INACTIVE');
          return { ok: false as const, reason: 'User inactive' };
        }
        const { token, hash } = newRefreshToken();
        const expiresAt = refreshExpiry();
        const next = await authRepo.createSession(tx, {
          userId: session.userId,
          familyId: session.familyId,
          tokenHash: hash,
          expiresAt,
          ...client,
        });
        await authRepo.rotateSession(tx, session.id, next.id);
        return {
          ok: true as const,
          tokens: {
            accessToken: signAccessToken(session.userId, next.id),
            refreshToken: token,
            refreshExpiresAt: expiresAt,
            userId: session.userId,
          },
        };
      },
      { isolation: 'Serializable' },
    );
    if (!outcome.ok) throw new AppError('UNAUTHENTICATED', outcome.reason, 401);
    return outcome.tokens;
  },

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await withTx(
      async (tx) => {
        const session = await authRepo.findSessionByHash(tx, hashToken(refreshToken));
        if (session) await authRepo.revokeFamily(tx, session.familyId, 'LOGOUT');
      },
      { isolation: 'ReadCommitted' },
    );
  },

  async me(userId: string): Promise<MeResponse> {
    const u = await authRepo.findUserAccess(userId);
    if (!u?.isActive) throw new AppError('UNAUTHENTICATED', 'User not found or inactive', 401);
    const activeRoles = u.roles.filter((r) => r.role.isActive);
    const perms = new Set(activeRoles.flatMap((r) => r.role.permissions.map((p) => p.permissionKey)));
    return {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      roles: activeRoles.map((r) => r.role.code),
      permissions: [...perms].sort(),
      mustChangePassword: u.mustChangePassword,
    };
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    await withTx(
      async (tx) => {
        const row = await authRepo.getPasswordHash(tx, userId);
        if (!row || !(await verifyPassword(row.passwordHash, currentPassword))) {
          throw new AppError('INVALID_CREDENTIALS', 'Current password is incorrect', 400);
        }
        await authRepo.updatePassword(tx, userId, await hashPassword(newPassword));
        await authRepo.revokeAllForUser(tx, userId, 'PASSWORD_CHANGED');
      },
      { isolation: 'ReadCommitted' },
    );
  },
};
