import { appPool, signupPool } from '../db.js';
import { auth } from '../lib/auth.js';
import type { TenantInput } from '../lib/tenant-input.js';
import { getTenantBySlug } from './tenant.js';

// Organization, owner membership and tenant are written through two pools, so
// this can't be one transaction. Each step either continues or ends with an
// outcome; a retry re-runs the whole sequence and resumes where it stopped.
export type ProvisionOutcome =
  | { kind: 'created'; slug: string }
  | { kind: 'existing'; slug: string }
  | { kind: 'slug_taken' }
  | { kind: 'failed'; detail: string };

interface OrgForCaller {
  id: string;
  role: string | null; // null: the organization exists but the caller is not a member
}

async function findOrgForCaller(slug: string, userId: string): Promise<OrgForCaller | null> {
  const { rows } = await appPool.query<OrgForCaller>(
    `SELECT organization.id, member.role
     FROM organization
     LEFT JOIN member ON member."organizationId" = organization.id AND member."userId" = $2
     WHERE organization.slug = $1`,
    [slug, userId],
  );
  return rows[0] ?? null;
}

// Visible through the app role's select policy only if the tenant is linked to
// an organization the caller is a member of.
async function isCallersTenant(slug: string, userId: string): Promise<boolean> {
  return (await getTenantBySlug(slug, true, userId)) !== null;
}

export async function provisionTenant(
  input: TenantInput,
  userId: string,
  headers: Headers,
): Promise<ProvisionOutcome> {
  const { name, slug, timezone } = input;

  // Pre-check: an existing tenant is either ours from an earlier attempt, or taken.
  if (await getTenantBySlug(slug)) {
    return (await isCallersTenant(slug, userId)) ? { kind: 'existing', slug } : { kind: 'slug_taken' };
  }

  // Reuse our own leftover organization; anyone else's means the slug is taken.
  let org = await findOrgForCaller(slug, userId);
  if (org && org.role !== 'owner') return { kind: 'slug_taken' };

  if (!org) {
    try {
      await auth.api.createOrganization({ body: { name, slug }, headers });
    } catch {
      // Decided from what's in the database, not the error: covers a slug race too.
    }
    org = await findOrgForCaller(slug, userId);
    if (!org) return { kind: 'failed', detail: 'organization_not_created' };
    if (org.role !== 'owner') return { kind: 'slug_taken' };
  }

  // The link goes in the INSERT, so no tenant can exist without one.
  const { rowCount } = await signupPool.query(
    `INSERT INTO tenant (name, slug, timezone, better_auth_org_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [name, slug, timezone, org.id],
  );
  if (rowCount === 1) return { kind: 'created', slug };

  // Conflict: our own tenant from a concurrent attempt, or another tenant took the slug.
  return (await isCallersTenant(slug, userId)) ? { kind: 'existing', slug } : { kind: 'slug_taken' };
}
