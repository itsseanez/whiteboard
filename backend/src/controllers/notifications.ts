// /me/notifications — the signed-in person's inbox.
//   GET  ?page&pageSize&status=all|unread&category=appointments|time_off|team
//   POST /:id/read
//   POST /read-all

import type { Request, Response } from 'express';
import { listNotifications, markAllRead, markRead, type Category } from '../services/notifications.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set<Category>(['appointments', 'time_off', 'team']);

function whole(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : null;
}

export async function getNotifications(req: Request, res: Response) {
  const page = whole(req.query.page, 1, 100_000);
  const pageSize = whole(req.query.pageSize, 20, 50);
  const status = req.query.status ?? 'all';
  const category = req.query.category === undefined || req.query.category === 'all' ? null : req.query.category;
  if (page === null || pageSize === null) return res.status(400).json({ error: 'page and pageSize must be whole numbers (pageSize up to 50)' });
  if (status !== 'all' && status !== 'unread') return res.status(400).json({ error: 'status must be all or unread' });
  if (category !== null && !CATEGORIES.has(category as Category)) {
    return res.status(400).json({ error: 'category must be appointments, time_off or team' });
  }
  res.json(
    await listNotifications(req.session!.session.userId, {
      page,
      pageSize,
      unreadOnly: status === 'unread',
      category: category as Category | null,
    }),
  );
}

export async function postRead(req: Request, res: Response) {
  const id = req.params.id;
  if (typeof id !== 'string' || !UUID.test(id)) return res.status(404).json({ error: 'not_found' });
  if (!(await markRead(req.session!.session.userId, id))) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
}

export async function postReadAll(req: Request, res: Response) {
  res.json({ marked: await markAllRead(req.session!.session.userId) });
}
