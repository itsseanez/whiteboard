import { postClosedLink } from './controllers/closed-link.js';
import { getHealth } from './controllers/health.js';
import express, { type Express, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import apiRouter from './routes/api/index.js';
import createPublicRouter from './routes/public/index.js';
import { PRODUCTION_LIMITS, createLimiters, type RateLimits } from './middleware/rate-limit.js';
import meRouter from './routes/me/index.js';
import { auth } from './lib/auth.js';
import { toNodeHandler } from 'better-auth/node';

// Where the Dockerfile puts the built frontend. Absent in development and in
// tests, where Vite serves the pages on its own port and proxies the API here.
const CLIENT_DIR = path.resolve(import.meta.dirname, '../client');
const CLIENT_INDEX = path.join(CLIENT_DIR, 'index.html');

export interface AppOptions {
  /** Off by default under Vitest, whose suites book far past any real limit. */
  rateLimits?: RateLimits | false;
}

export function createApp(options: AppOptions = {}): Express {
  const app: Express = express();
  const limits = createLimiters(
    options.rateLimits ?? (process.env.NODE_ENV === 'test' ? false : PRODUCTION_LIMITS),
  );

  // Caddy is the one hop in front of us, and it replaces any X-Forwarded-For a
  // client sends with the real peer address. Trusting exactly one hop makes
  // req.ip that address; without it every request is Caddy's, one shared bucket.
  app.set('trust proxy', 1);

  app.get('/api/health', getHealth);
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
  // reached, so the pages the client serves are named here explicitly.
  //
  // Explicit paths rather than a wildcard, so this can never shadow an API
  // route: adding an endpoint under /:slug needs no thought about ordering.
  if (hasClient) {
    const page = (_req: Request, res: Response) => res.sendFile(CLIENT_INDEX);
    app.get('/', page);
    // Before /:slug, which would match them by accident. Also reserved slugs —
    // see frontend/src/slug.ts.
    app.get('/signin', page);
    app.get('/privacy', page);
    app.get('/signin/forgot', page);
    app.get('/signin/reset', page);
    app.get('/signup', page);
    app.get('/account', page);
    app.get('/account/inbox', page);
    app.get('/manage/:slug', page);
    app.get('/manage/:slug/calendar', page);
    app.get('/manage/:slug/me', page);
    app.get('/invite/:id', page);
    app.get('/:slug', page);
    app.get('/:slug/manage', page);
  }

  app.use('/tenant/:slug', apiRouter);
  app.use('/me', meRouter);
  // Before /:slug, which would otherwise read "links" as an organization.
  app.post('/links/closed', limits.manage, postClosedLink);
  app.use('/:slug', createPublicRouter(limits));

  if (!hasClient) {
    // Development and test. The API is the whole app here.
    app.get('/', (_req: Request, res: Response) => {
      res.json({ service: 'whiteboard-api', client: 'not built' });
    });
  }

  return app;
}
