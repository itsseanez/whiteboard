import express, { type Express, type Request, type Response } from 'express';

export function createApp(): Express {
  const app: Express = express();

  app.use(express.json());

  app.get('/', (req: Request, res: Response) => {
    res.send('Hello World!');
  });

  return app;
}