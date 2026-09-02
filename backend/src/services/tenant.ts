import { publicPool, appPool } from '../db.js';
import { withContext } from '../withContext.js';

export async function getTenantBySlug(
  slug: string,
  includeOrgId: true,
  userId: string
): Promise<{ id: string; slug: string; timezone: string; betterAuthOrgId: string } | null>;

export async function getTenantBySlug(
  slug: string,
  includeOrgId?: false
): Promise<{ id: string; slug: string; timezone: string } | null>;

export async function getTenantBySlug(
  slug: string,
  includeOrgId = false,
  userId?: string
) {
  if (includeOrgId) {
    return withContext(appPool, { userId }, async (client) => {
      const { rows } = await client.query(
        `SELECT id, slug, timezone, better_auth_org_id AS "betterAuthOrgId"
         FROM tenant WHERE slug = $1`,
        [slug]
      );
      return rows[0] ?? null;
    });
  }

  const { rows } = await publicPool.query(
    `SELECT id, slug, timezone FROM tenant WHERE slug = $1`,
    [slug]
  );
  return rows[0] ?? null;
}

export async function getMembershipByUserIdAndOrgId(userId: string, betterAuthOrgId: string) {
  const { rows } = await appPool.query(
    `SELECT role FROM member WHERE "userId" = $1 AND "organizationId" = $2`,
    [userId, betterAuthOrgId]
  );
  return rows[0] ?? null;
};

export async function getTenantsByUserId(userId: string) {
  return withContext(appPool, { userId }, async (client) => {
    const { rows } = await client.query(
      `
      SELECT
        tenant.id AS "tenantId",
        tenant.slug,
        tenant.timezone,
        member.role
      FROM member
      JOIN tenant ON member."organizationId" = tenant.better_auth_org_id
      WHERE member."userId" = $1
      `,
      [userId]
    );
    return rows;
  });
};