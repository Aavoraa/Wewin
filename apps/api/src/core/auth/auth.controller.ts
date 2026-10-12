import { type Request, type Response } from 'express';
import { type LoginResponse } from '@wewin/shared';
import { env } from '../../config/env';
import { HANDLED, type HandlerInput } from '../http';
import { authService, type IssuedTokens } from './auth.service';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './tokens';
import { type zChangePasswordBody, type zLoginBody } from './auth.routes';

function client(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) };
}

function setRefreshCookie(res: Response, t: IssuedTokens) {
  res.cookie(REFRESH_COOKIE, t.refreshToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires: t.refreshExpiresAt,
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict', path: REFRESH_COOKIE_PATH });
}

async function tokenResponse(res: Response, t: IssuedTokens): Promise<LoginResponse> {
  setRefreshCookie(res, t);
  return { accessToken: t.accessToken, expiresIn: env.ACCESS_TOKEN_TTL_SEC, user: await authService.me(t.userId) };
}

export const authController = {
  async login({ body, req, res }: HandlerInput<{ body: typeof zLoginBody }>) {
    const t = await authService.login(body.username, body.password, client(req));
    return tokenResponse(res, t);
  },

  async refresh({ req, res }: HandlerInput<object>) {
    try {
      const t = await authService.refresh(req.cookies?.[REFRESH_COOKIE] as string | undefined, client(req));
      return await tokenResponse(res, t);
    } catch (e) {
      clearRefreshCookie(res);
      throw e;
    }
  },

  async logout({ req, res }: HandlerInput<object>) {
    await authService.logout(req.cookies?.[REFRESH_COOKIE] as string | undefined);
    clearRefreshCookie(res);
    res.status(204).end();
    return HANDLED;
  },

  me({ user }: HandlerInput<object>) {
    return authService.me(user.id);
  },

  async changePassword({ user, body, res }: HandlerInput<{ body: typeof zChangePasswordBody }>) {
    await authService.changePassword(user.id, body.currentPassword, body.newPassword);
    clearRefreshCookie(res);
    return { ok: true };
  },
};
