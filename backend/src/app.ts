import express, { type Express, type Request, type Response } from 'express';
import apiRouter from './routes/api/index.js';
import publicRouter from './routes/public/index.js';
import meRouter from './routes/me/index.js';
import { auth } from './lib/auth.js';
import { toNodeHandler } from 'better-auth/node';

export function createApp(): Express {
  const app: Express = express();

  app.all('/api/auth/*splat', toNodeHandler(auth));
  app.use(express.json());

  app.use('/tenant/:slug', apiRouter);
  app.use('/me', meRouter);
  app.use('/:slug', publicRouter);
  
  app.get('/', (req: Request, res: Response) => {
    res.send('Hello World!');
  });

  return app;
}