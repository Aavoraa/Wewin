import { env } from './config/env';
import { createApp } from './app';
import { logger } from './core/logger';
import { prisma } from './core/db';
import { syncPermissions } from './core/auth/permissions.sync';
import { startJobs, stopJobs } from './jobs/queue';
import './jobs/register';

async function main() {
  await prisma.$connect();
  await syncPermissions();
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Wewin ERP API listening');
  });
  await startJobs();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close();
    await stopJobs();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
