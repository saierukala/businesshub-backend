import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler, notFound } from './middleware/errorHandler';
import { healthRouter } from './routes/health';
import { authRouter } from './routes/auth';
import { categoriesRouter, servicesRouter } from './routes/catalog';
import { customersRouter } from './routes/customers';
import { addressesRouter } from './routes/addresses';
import { appliancesRouter } from './routes/appliances';
import { usersRouter } from './routes/users';
import { techniciansRouter } from './routes/technicians';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1); // correct client IPs behind Render/Railway proxies
  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(healthRouter);
  app.use('/auth', authRouter);
  app.use('/service-categories', categoriesRouter);
  app.use('/services', servicesRouter);
  app.use('/customers', customersRouter);
  app.use('/addresses', addressesRouter);
  app.use('/appliances', appliancesRouter);
  app.use('/users', usersRouter);
  app.use('/technicians', techniciansRouter);
  // Later phases mount: /bookings, ...

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
