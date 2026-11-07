import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Client, Pool } from 'pg';
import { randomUUID } from 'node:crypto';

// The member_keeps_an_owner trigger, straight at the database as the auth
// role, which is the role Better Auth changes memberships through.
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);

let orgId = '';
let tenantId = '';
let ownerA = '';
let ownerB = '';
const users: string[] = [];

async function user(label: string): Promise<string> {
  const id = randomUUID();
  await ownerPool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES ($1, $2, $3, false, now(), now())`,
    [id, label, `${label}-${run}-${id.slice(0, 4)}@test.example`],
  );
  users.push(id);
  return id;
}

async function member(userId: string, role: string): Promise<string> {
  const id = randomUUID();
  await ownerPool.query(`INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())`, [
    id,
    orgId,
    userId,
    role,
  ]);
  return id;
}

async function auth(): Promise<Client> {
  const client = new Client({ connectionString: process.env.AUTH_DATABASE_URL });
  await client.connect();
  return client;
}

const code = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: { constraint?: string }) => e.constraint,
  );

beforeEach(async () => {
  orgId = randomUUID();
  await ownerPool.query(`INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Owners', $2, now())`, [
    orgId,
    `owners-${run}-${orgId.slice(0, 6)}`,
  ]);
  tenantId = (
    await ownerPool.query<{ id: string }>(
      `INSERT INTO tenant (name, slug, timezone, better_auth_org_id) VALUES ('Owners', $1, 'UTC', $2) RETURNING id`,
      [`owners-${run}-${orgId.slice(0, 6)}`, orgId],
    )
  ).rows[0]!.id;
  ownerA = await member(await user('a'), 'owner');
  ownerB = await member(await user('b'), 'owner');
});

afterAll(async () => {
  await ownerPool.query(`DELETE FROM tenant WHERE slug LIKE $1`, [`owners-${run}-%`]);
  await ownerPool.query(`DELETE FROM member WHERE "userId" = ANY($1)`, [users]);
  await ownerPool.query(`DELETE FROM organization WHERE slug LIKE $1`, [`owners-${run}-%`]);
  await ownerPool.query(`DELETE FROM "user" WHERE id = ANY($1)`, [users]);
  await ownerPool.end();
});

describe('an open organization keeps an owner', () => {
  it('lets one of two owners step down, not both', async () => {
    const db = await auth();
    try {
      await db.query(`UPDATE member SET role = 'admin' WHERE id = $1`, [ownerA]);
      expect(await code(db.query(`UPDATE member SET role = 'admin' WHERE id = $1`, [ownerB]))).toBe(
        'organization_keeps_an_owner',
      );
      expect(await code(db.query(`DELETE FROM member WHERE id = $1`, [ownerB]))).toBe('organization_keeps_an_owner');
    } finally {
      await db.end();
    }
  });

  it('refuses the second of two owners demoting each other at the same moment', async () => {
    const first = await auth();
    const second = await auth();
    try {
      await first.query('BEGIN');
      await second.query('BEGIN');
      await first.query(`UPDATE member SET role = 'admin' WHERE id = $1`, [ownerA]);

      // Without the lock this would count A as still an owner (uncommitted) and succeed.
      let settled = false;
      const racing = code(second.query(`UPDATE member SET role = 'admin' WHERE id = $1`, [ownerB])).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(settled).toBe(false); // waiting on the organization's lock

      await first.query('COMMIT');
      expect(await racing).toBe('organization_keeps_an_owner');
      await second.query('ROLLBACK');

      const { rows } = await ownerPool.query(`SELECT count(*)::int AS n FROM member WHERE "organizationId" = $1 AND role = 'owner'`, [orgId]);
      expect(rows[0].n).toBe(1);
    } finally {
      await first.end();
      await second.end();
    }
  });

  it('lets the last owner go once the organization is closed', async () => {
    const db = await auth();
    try {
      await db.query(`DELETE FROM member WHERE id = $1`, [ownerA]);
      await ownerPool.query(`UPDATE tenant SET archived_at = now() WHERE id = $1`, [tenantId]);
      expect(await code(db.query(`DELETE FROM member WHERE id = $1`, [ownerB]))).toBeUndefined();
    } finally {
      await db.end();
    }
  });

  it('ignores changes that keep someone an owner, and other roles entirely', async () => {
    const db = await auth();
    try {
      const staff = await member(await user('s'), 'member');
      expect(await code(db.query(`UPDATE member SET role = 'owner' WHERE id = $1`, [ownerA]))).toBeUndefined();
      expect(await code(db.query(`DELETE FROM member WHERE id = $1`, [staff]))).toBeUndefined();
    } finally {
      await db.end();
    }
  });
});
