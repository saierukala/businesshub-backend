import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './db/prisma';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(`BusinessHub API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

// Close cleanly on Ctrl+C or when the host stops the container/process.
function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
