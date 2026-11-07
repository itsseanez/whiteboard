// Per-IP limits on the public, unauthenticated routes. Better Auth limits its
// own routes; these cover ours.
//
// The counts live in this process's memory: one Express process serves the
// app, so one store sees every request. A second instance would need a shared
// store, and a deploy resets the counts, which only ever errs toward allowing.

import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

export interface Limit {
  limit: number;
  windowMs: number;
}

export interface RateLimits {
  /** Public reads: the catalog and availability, which runs the engine. */
  read: Limit;
  /** New bookings. Each one emails whatever address it was given. */
  book: Limit;
  /** Anything carrying a manage token: cancel, reschedule, move times, closed links. */
  manage: Limit;
}

const MINUTE = 60_000;

export const PRODUCTION_LIMITS: RateLimits = {
  read: { limit: 300, windowMs: 5 * MINUTE },
  book: { limit: 10, windowMs: 60 * MINUTE },
  manage: { limit: 60, windowMs: 15 * MINUTE },
};

export type Limiters = Record<keyof RateLimits, RequestHandler>;

const pass: RequestHandler = (_req, _res, next) => next();

function limiter({ limit, windowMs }: Limit): RequestHandler {
  return rateLimit({
    limit,
    windowMs,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate_limited' });
    },
  });
}

/** One store per group, so booking can't use up the manage page's allowance. */
export function createLimiters(limits: RateLimits | false): Limiters {
  if (!limits) return { read: pass, book: pass, manage: pass };
  return { read: limiter(limits.read), book: limiter(limits.book), manage: limiter(limits.manage) };
}
