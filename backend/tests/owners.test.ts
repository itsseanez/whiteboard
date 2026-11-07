import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { outbox } from '../src/lib/mailer.js';

// More than one owner: owners change anyone's role, their own included, and
// deleting your account is refused only while you're an open organization's
// last owner.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);
const slug = `owners-${run}`;
const PASSWORD = 'test-password-123';
const emails: string[] = [];

let tenantId = '';
let orgId = '';
let founder = { cookie: '', userId: '' };
let manager = { cookie: '', userId: '' };
let staff = { cookie: '', userId: '' };

const email = (label: string) => {
  const e = `${label}-${run}@test.example`;
  emails.push(e);
  return e;
};

function cookieOf(res: request.Response): string {
  return (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
}

async function signUp(address: string) {
  const res = await request(app).post('/api/auth/sign-up/email').send({ name: address.split('-')[0], email: address, password: PASSWORD });
  return { cookie: cookieOf(res), userId: res.body.user.id as string };
}

const api = {
  post: (path: string, body: object, c: string) => request(app).post(`/tenant/${slug}${path}`).set('Cookie', c).send(body),
  patch: (path: string, body: object, c: string) => request(app).patch(`/tenant/${slug}${path}`).set('Cookie', c).send(body),
};

async function invitedAndAccepted(label: string, role: 'staff' | 'manager', staffId: string | null) {
  const address = email(label);
  expect((await api.post('/invitations', { email: address, role, ...(staffId ? { staffId } : {}) }, founder.cookie)).status).toBe(201);
  const user = await signUp(address);
  const id = [...outbox].reverse().find((m) => m.to === address && m.text.includes('/invite/'))?.text.match(/\/invite\/([^?\s]+)/)?.[1];
  expect((await request(app).post(`/me/invitations/${id}/accept`).set('Cookie', user.cookie)).status).toBe(200);
  return user;
}

async function memberId(userId: string): Promise<string> {
  return (await ownerPool.query('SELECT id FROM member WHERE "organizationId" = $1 AND "userId" = $2', [orgId, userId])).rows[0].id;
}

async function roleOf(userId: string): Promise<string | undefined> {
  return (await ownerPool.query('SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2', [orgId, userId])).rows[0]?.role;
}

const setRole = (userId: string, role: string, by: string) => memberId(userId).then((id) => api.patch(`/members/${id}`, { role }, by));

beforeAll(async () => {
  founder = await signUp(email('founder'));
  await request(app).post('/me/tenants').set('Cookie', founder.cookie).send({ name: 'Owners', slug, timezone: 'UTC' }).expect(201);
  ({ id: tenantId, better_auth_org_id: orgId } = (await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug])).rows[0]);
  const row = (await api.post('/staff', { name: 'Sam' }, founder.cookie)).body.id;
  manager = await invitedAndAccepted('mgr', 'manager', null);
  staff = await invitedAndAccepted('sam', 'staff', row);
});

afterAll(async () => {
  await ownerPool.query('UPDATE tenant SET archived_at = now() WHERE id = $1', [tenantId]); // lets the last owner go
  await ownerPool.query('DELETE FROM staff WHERE tenant_id = $1', [tenantId]);
  await ownerPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  await ownerPool.query('DELETE FROM invitation WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM organization WHERE id = $1', [orgId]);
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
});

describe('changing roles', () => {
  it('is for owners only', async () => {
    expect((await setRole(staff.userId, 'manager', manager.cookie)).status).toBe(403);
    expect((await setRole(manager.userId, 'owner', manager.cookie)).status).toBe(403);
  });

  it("won't let the only owner step down", async () => {
    const res = await setRole(founder.userId, 'manager', founder.cookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'last_owner' });
    expect(await roleOf(founder.userId)).toBe('owner');
  });

  it('makes a manager an owner, who can then change roles', async () => {
    expect((await setRole(manager.userId, 'owner', founder.cookie)).status).toBe(204);
    expect(await roleOf(manager.userId)).toBe('owner');
    expect((await setRole(staff.userId, 'manager', manager.cookie)).status).toBe(204);
    expect((await setRole(staff.userId, 'staff', manager.cookie)).status).toBe(204);
  });

  it('lets one of two owners step down, then keeps the other', async () => {
    expect((await setRole(founder.userId, 'manager', founder.cookie)).status).toBe(204);
    expect(await roleOf(founder.userId)).toBe('admin');
    const last = await setRole(manager.userId, 'staff', manager.cookie);
    expect(last.status).toBe(409);
    expect((await setRole(founder.userId, 'owner', manager.cookie)).status).toBe(204);
  });

  it("refuses a role that isn't one", async () => {
    expect((await setRole(staff.userId, 'admin', founder.cookie)).status).toBe(400);
  });
});

describe('deleting your account as an owner', () => {
  it('is refused for the last owner, allowed while another owner remains', async () => {
    // founder and manager are both owners now.
    const coOwner = await request(app).post('/api/auth/delete-user').set('Cookie', manager.cookie).send({ password: PASSWORD });
    expect(coOwner.status, JSON.stringify(coOwner.body)).toBe(200);

    const last = await request(app).post('/api/auth/delete-user').set('Cookie', founder.cookie).send({ password: PASSWORD });
    expect(last.status).toBe(400);
    expect(last.body.code).toBe('OWNS_ORGANIZATIONS');
    expect(await roleOf(founder.userId)).toBe('owner');
  });
});
