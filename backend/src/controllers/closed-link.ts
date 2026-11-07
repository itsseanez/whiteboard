// POST /links/closed { token } — does this manage link belong to a closed
// organization? Not under /:slug, because once a closed slug is released and
// taken by someone else, the slug in an old link points at the new owner.
// The token stays in the body, as on every manage route.

import type { Request, Response } from 'express';
import { publicPool } from '../db.js';
import { hashManageToken } from '../services/manage-token.js';

export async function postClosedLink(req: Request, res: Response) {
  const token = (req.body as { token?: unknown } | undefined)?.token;
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) {
    return res.status(404).json({ error: 'not_closed' });
  }
  const { rows } = await publicPool.query<{ name: string; closed_at: Date }>(
    'SELECT name, closed_at FROM closed_organization_for_token($1)',
    [hashManageToken(token)],
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_closed' });
  res.json({ name: rows[0].name, closedAt: rows[0].closed_at.toISOString() });
}
