import express, { type Express, type Request, type Response } from 'express';
import apiRouter from './routes/api/index.js';
import publicRouter from './routes/public/index.js';

export function createApp(): Express {
  const app: Express = express();

  app.use(express.json());

  app.get('/', (req: Request, res: Response) => {
    res.send('Hello World!');
  });
  //app.use('/tenant/:slug', apiRouter);
  app.use('/:slug', publicRouter);

  return app;
}