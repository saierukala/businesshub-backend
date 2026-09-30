import { Router } from 'express';
import { prisma } from '../db/prisma';

export const healthRouter = Router();

// Liveness: is the process up? (no database call)
healthRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

// Readiness: can we reach the database?
healthRouter.get('/health/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', database: 'up' });
  } catch (err) {
    req.log.error({ err }, 'Database health check failed');
    res.status(503).json({ status: 'unavailable', database: 'down' });
  }
});
