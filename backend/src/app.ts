import express, { type Express, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import apiRouter from './routes/api/index.js';
import publicRouter from './routes/public/index.js';
import meRouter from './routes/me/index.js';
import { auth } from './lib/auth.js';
import { toNodeHandler } from 'better-auth/node';

// Where the Dockerfile puts the built frontend. Absent in development and in
// tests, where Vite serves the pages on its own port and proxies the API here.
const CLIENT_DIR = path.resolve(import.meta.dirname, '../client');
const CLIENT_INDEX = path.join(CLIENT_DIR, 'index.html');

export function createApp(): Express {
  const app: Express = express();

  app.all('/api/auth/*splat', toNodeHandler(auth));
  app.use(express.json());

  // Hashed build output — /assets/index-a1b2c3.js and friends. Mounted before
  // the routers because it is the hot path and matches only real files.
  //
  // The whole block is conditional rather than always-on so that a missing
  // build is a 404 on the page routes, not an ENOENT thrown from a handler.
  const hasClient = existsSync(CLIENT_INDEX);
  if (hasClient) {
    app.use(express.static(CLIENT_DIR, { index: false }));
  }

  // The page routes, registered BEFORE the public router on purpose.
  //
  // publicRouter ends in a catch-all that answers anything unmatched under
  // /:slug with a JSON 404 — correct for an API client, useless for a browser
  // asking for /studio-wien/manage. A fallback mounted after it would never be
  // reached, so the two pages the client serves are named here explicitly.
  //
  // Explicit paths rather than a wildcard, so this can never shadow an API
  // route: adding an endpoint under /:slug needs no thought about ordering.
  if (hasClient) {
    const page = (_req: Request, res: Response) => res.sendFile(CLIENT_INDEX);
    app.get('/', page);
    app.get('/:slug', page);
    app.get('/:slug/manage', page);
  }

  app.use('/tenant/:slug', apiRouter);
  app.use('/me', meRouter);
  app.use('/:slug', publicRouter);

  if (!hasClient) {
    // Development and test. The API is the whole app here.
    app.get('/', (_req: Request, res: Response) => {
      res.json({ service: 'whiteboard-api', client: 'not built' });
    });
  }

  return app;
}
