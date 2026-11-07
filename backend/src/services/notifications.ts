// The signed-in person's inbox. RLS on notification limits every query here
// to rows addressed to app.user_id, across all their organizations.

import { appPool } from '../db.js';
import { withContext } from '../withContext.js';

export type Category = 'appointments' | 'time_off' | 'team';

export interface Notification {
  id: string;
  kind: string;
  category: Category;
  link: string;
  data: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

export interface Page {
  items: Notification[];
  total: number;
  unread: number;
  page: number;
  pageSize: number;
}

interface Row {
  id: string;
  kind: string;
  category: Category;
  link: string;
  data: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
}

const shape = (r: Row): Notification => ({
  id: r.id,
  kind: r.kind,
  category: r.category,
  link: r.link,
  data: r.data,
  createdAt: r.createdAt.toISOString(),
  read: r.readAt !== null,
});

export async function listNotifications(
  userId: string,
  options: { page: number; pageSize: number; unreadOnly: boolean; category: Category | null },
): Promise<Page> {
  return withContext(appPool, { userId }, async (client) => {
    const filters = ['true'];
    const params: unknown[] = [];
    if (options.unreadOnly) filters.push('read_at IS NULL');
    if (options.category) {
      params.push(options.category);
      filters.push(`category = $${params.length}`);
    }
    const where = filters.join(' AND ');
    const counted = await client.query<{ total: number; unread: number }>(
      `SELECT (SELECT count(*)::int FROM notification WHERE ${where}) AS total,
              (SELECT count(*)::int FROM notification WHERE read_at IS NULL) AS unread`,
      params,
    );
    const offset = (options.page - 1) * options.pageSize;
    const { rows } = await client.query<Row>(
      `SELECT id, kind, category, link, data, created_at AS "createdAt", read_at AS "readAt"
       FROM notification WHERE ${where}
       ORDER BY created_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, options.pageSize, offset],
    );
    return {
      items: rows.map(shape),
      total: counted.rows[0]?.total ?? 0,
      unread: counted.rows[0]?.unread ?? 0,
      page: options.page,
      pageSize: options.pageSize,
    };
  });
}

/** Marks one read. Someone else's id finds nothing, and changes nothing. */
export async function markRead(userId: string, id: string): Promise<boolean> {
  return withContext(appPool, { userId }, async (client) => {
    const { rowCount } = await client.query('UPDATE notification SET read_at = now() WHERE id = $1 AND read_at IS NULL', [id]);
    if (rowCount) return true;
    const { rowCount: exists } = await client.query('SELECT 1 FROM notification WHERE id = $1', [id]);
    return exists === 1;
  });
}

export async function markAllRead(userId: string): Promise<number> {
  return withContext(appPool, { userId }, async (client) => {
    const { rowCount } = await client.query('UPDATE notification SET read_at = now() WHERE read_at IS NULL');
    return rowCount ?? 0;
  });
}
