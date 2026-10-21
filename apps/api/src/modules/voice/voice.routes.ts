import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { zVoiceInterpret } from '@wewin/shared';
import { requirePermission } from '../../core/auth/auth.middleware';
import { handle } from '../../core/http';
import { voiceService as s } from './voice.service';

/**
 * /api/v1/voice — any signed-in user. Interpretation only reads: answers come from reports the user
 * may run (reports.run re-checks the permission) and form values are returned for the user to review.
 */
export const voiceRouter = Router();
const signedIn = requirePermission();
// Each request may call an external AI service; keep a person from hammering it.
const limit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user?.id ?? req.ip ?? 'anon' });

voiceRouter.get('/voice/config', signedIn, handle({}, () => s.config()));
voiceRouter.post('/voice/interpret', signedIn, limit, handle({ body: zVoiceInterpret }, ({ body, user }) => s.interpret(body, user)));
