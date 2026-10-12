import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { zChangePassword, zLogin } from '@wewin/shared';
import { env } from '../../config/env';
import { handle } from '../http';
import { authController } from './auth.controller';
import { authenticate } from './auth.middleware';

export const zLoginBody = zLogin;
export const zChangePasswordBody = zChangePassword;

const limiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.AUTH_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } });
  },
});

/** /api/v1/auth — rate limited (A§10). */
export const authRouter = Router();
authRouter.post('/login', limiter, handle({ body: zLoginBody }, authController.login, { public: true }));
authRouter.post('/refresh', limiter, handle({}, authController.refresh, { public: true }));
authRouter.post('/logout', handle({}, authController.logout, { public: true }));
authRouter.get('/me', authenticate, handle({}, authController.me));
authRouter.post('/change-password', limiter, authenticate, handle({ body: zChangePasswordBody }, authController.changePassword));
