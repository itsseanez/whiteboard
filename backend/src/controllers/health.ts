// GET /api/health — for an uptime monitor. 200 when the database answers,
// 503 when it doesn't. Also says which client address the app sees, which is
// how to check that Caddy forwards the real one (rate limits depend on it),
// and how much email is waiting in the outbox.

import type { Request, Response } from 'express';
import { appPool } from '../db.js';

export async function getHealth(req: Request, res: Response) {
  try {
    const { rows } = await appPool.query<{ waiting: number; oldest: number | null }>(
      `SELECT count(*)::int AS waiting,
              floor(extract(epoch FROM now() - min(created_at)) / 60)::int AS oldest
       FROM job WHERE finished_at IS NULL`,
    );
    res.set('cache-control', 'no-store').json({
      ok: true,
      clientIp: req.ip,
      outbox: { waiting: rows[0]?.waiting ?? 0, oldestMinutes: rows[0]?.oldest ?? null },
    });
  } catch {
    res.status(503).set('cache-control', 'no-store').json({ ok: false, error: 'database unavailable' });
  }
}
