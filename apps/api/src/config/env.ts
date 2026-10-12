import { z } from 'zod';

/** Environment parsed once at start-up; the server refuses to start if anything required is missing (A§5). */
const zEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGIN: z.string().min(1),
  PORT: z.coerce.number().int().default(4000),
  TZ: z.literal('Asia/Kolkata'),
  FY_START_MONTH: z.coerce.number().int().min(1).max(12).default(4),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  STORAGE_DIR: z.string().default('./storage'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  AUTH_RATE_LIMIT: z.coerce.number().int().min(1).default(30),
  ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(7),
  WHATSAPP_PROVIDER: z.string().optional().default(''),
  WHATSAPP_API_URL: z.string().optional().default(''),
  WHATSAPP_API_TOKEN: z.string().optional().default(''),
});

export type Env = z.infer<typeof zEnv>;

function load(): Env {
  const parsed = zEnv.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = load();
