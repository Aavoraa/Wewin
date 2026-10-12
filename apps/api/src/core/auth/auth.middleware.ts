import { type RequestHandler } from 'express';
import { type PermissionKey } from '@wewin/shared';
import { AppError } from '../errors/app-error';
import { setContextUser } from '../context';
import { authRepo } from './auth.repo';
import { verifyAccessToken } from './tokens';
import { type CurrentUser } from './auth.types';

/** Short cache of user permissions; invalidated when roles/users change in this process. */
const CACHE_MS = 10_000;
const cache = new Map<string, { at: number; user: Omit<CurrentUser, 'sessionId'> | null }>();

export function invalidateAccessCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

async function loadAccess(userId: string): Promise<Omit<CurrentUser, 'sessionId'> | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;
  const u = await authRepo.findUserAccess(userId);
  const user =
    u && u.isActive
      ? {
          id: u.id,
          username: u.username,
          fullName: u.fullName,
          roles: u.roles.filter((r) => r.role.isActive).map((r) => r.role.code),
          permissions: new Set(
            u.roles.filter((r) => r.role.isActive).flatMap((r) => r.role.permissions.map((p) => p.permissionKey)),
          ),
        }
      : null;
  cache.set(userId, { at: Date.now(), user });
  return user;
}

/** Requires a valid Bearer access token; attaches req.user and tags the request context. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
  let claims;
  try {
    claims = verifyAccessToken(header.slice(7));
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Session expired', 401);
  }
  const user = await loadAccess(claims.sub);
  if (!user) throw new AppError('UNAUTHENTICATED', 'User not found or inactive', 401);
  req.user = { ...user, sessionId: claims.sid };
  setContextUser(user.id);
  next();
};

/** Route guard: the user must hold every listed permission (server-side, A§10). */
export function requirePermission(...keys: PermissionKey[]): RequestHandler {
  return (req, _res, next) => {
    const user = req.user;
    if (!user) throw new AppError('UNAUTHENTICATED', 'Login required', 401);
    const missing = keys.filter((k) => !user.permissions.has(k));
    if (missing.length) {
      throw new AppError('FORBIDDEN', 'You do not have permission for this action', 403, { missing });
    }
    next();
  };
}

/** Service-level re-check for sensitive rules. */
export function assertPermission(user: CurrentUser, key: PermissionKey): void {
  if (!user.permissions.has(key)) {
    throw new AppError('FORBIDDEN', 'You do not have permission for this action', 403, { missing: [key] });
  }
}
