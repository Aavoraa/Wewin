import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[redacted]',
  },
  // Pretty, human-readable logs only on a developer machine (never on Vercel, where the package is not deployed).
  ...(env.NODE_ENV === 'development' && !process.env.VERCEL
    ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:standard', singleLine: true } } }
    : {}),
});
