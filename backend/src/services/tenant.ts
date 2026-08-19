import { publicPool } from '../db.js';

export const getTenantBySlug = async (slug: string) => {
  const result = await publicPool.query(
    `
      SELECT id, name, slug, timezone
      FROM tenant
      WHERE slug = $1
    `,
    [slug]
  );

  return result.rows[0] ?? null;
};