import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

// Deleting your own account: refused while you own an open organization;
// otherwise your sign-in and memberships go, and a staff row you were linked
// to stays, unlinked.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);
const slug = `deleting-${run}`;
const PASSWORD = 'test-password-123';
const emails: string[] = [];

let owner = { cookie: '', userId: '' };
let staff = { cookie: '', userId: '' };
let tenantId = '';
let orgId = '';
let staffRow = '';

async function signUp(label: string) {
  const email = `${label}-${run}@test.example`;
  emails.push(email);
  const res = await request(app).post('/api/auth/sign-up/email').send({ name: label, email, password: PASSWORD });
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
  return { cookie, userId: res.body.user.id as string };
}

const deleteAccount = (cookie: string, password = PASSWORD) =>
  request(app).post('/api/auth/delete-user').set('Cookie', cookie).send({ password });

const userExists = async (id: string) =>
  (await ownerPool.query('SELECT 1 FROM "user" WHERE id = $1', [id])).rowCount === 1;

beforeAll(async () => {
  owner = await signUp('owner');
  await request(app).post('/me/tenants').set('Cookie', owner.cookie).send({ name: 'Deleting', slug, timezone: 'UTC' }).expect(201);
  ({ id: tenantId, better_auth_org_id: orgId } = (
    await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug])
  ).rows[0]);
  staffRow = (await request(app).post(`/tenant/${slug}/staff`).set('Cookie', owner.cookie).send({ name: 'Ana' })).body.id;

  staff = await signUp('staff');
  await ownerPool.query(
    `INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, 'member', now())`,
    [randomUUID(), orgId, staff.userId],
  );
  await ownerPool.query('UPDATE staff SET user_id = $1 WHERE id = $2', [staff.userId, staffRow]);
});

afterAll(async () => {
  await ownerPool.query('DELETE FROM staff WHERE tenant_id = $1', [tenantId]);
  await ownerPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM organization WHERE id = $1', [orgId]);
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
});

describe('deleting your account', () => {
  it('needs the right password, even from a fresh session', async () => {
    const none = await request(app).post('/api/auth/delete-user').set('Cookie', staff.cookie).send({});
    expect(none.status).toBe(400);
    expect(none.body.code).toBe('PASSWORD_REQUIRED');
    expect((await deleteAccount(staff.cookie, 'wrong-password')).status).toBe(400);
    expect(await userExists(staff.userId)).toBe(true);
  });

  it('removes a staff member’s sign-in and membership, and keeps their staff row', async () => {
    expect((await deleteAccount(staff.cookie)).status).toBe(200);
    expect(await userExists(staff.userId)).toBe(false);
    const member = await ownerPool.query('SELECT 1 FROM member WHERE "userId" = $1', [staff.userId]);
    expect(member.rowCount).toBe(0);
    const row = await ownerPool.query('SELECT user_id, name FROM staff WHERE id = $1', [staffRow]);
    expect(row.rows[0]).toEqual({ user_id: null, name: 'Ana' });
  });

  it('is refused while you own an open organization', async () => {
    const res = await deleteAccount(owner.cookie);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OWNS_ORGANIZATIONS');
    expect(res.body.message).toContain('Deleting');
    expect(await userExists(owner.userId)).toBe(true);
  });

  it('is allowed once the owner has closed it', async () => {
    await request(app).delete(`/tenant/${slug}`).set('Cookie', owner.cookie).send({ confirm: slug }).expect(200);
    expect((await deleteAccount(owner.cookie)).status).toBe(200);
    expect(await userExists(owner.userId)).toBe(false);
  });
});
