import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { outbox } from '../src/lib/mailer.js';
import { appPool } from '../src/db.js';
import { withContext } from '../src/withContext.js';
import { hashManageToken } from '../src/services/manage-token.js';

// Closing an organization: owner only, future bookings cancelled and emailed,
// past ones kept, and the organization gone from every page afterwards.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);
const slug = `closing-${run}`;
const emails: string[] = [];
const customerEmail = `kept-informed-${run}@customer.example`;

let owner = '';
let manager = { cookie: '', userId: '' };
let tenantId = '';
let orgId = '';
let future = '';
let past = '';
const futureToken = `token-${run}-future`;

async function signUp(label: string) {
  const email = `${label}-${run}@test.example`;
  emails.push(email);
  const res = await request(app).post('/api/auth/sign-up/email').send({ name: label, email, password: 'test-password-123' });
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
  return { cookie, userId: res.body.user.id as string };
}

async function appointment(staffId: string, serviceId: string, customerId: string, startsAt: Date, token?: string) {
  const ends = new Date(startsAt.getTime() + 3_600_000);
  const { rows } = await ownerPool.query(
    `INSERT INTO appointment (tenant_id, staff_id, service_id, customer_id, starts_at, ends_at,
                              blocked_starts_at, blocked_ends_at, manage_token_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7) RETURNING id`,
    [tenantId, staffId, serviceId, customerId, startsAt, ends, token ? hashManageToken(token) : randomBytes(32).toString('hex')],
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  ({ cookie: owner } = await signUp('owner'));
  await request(app).post('/me/tenants').set('Cookie', owner).send({ name: 'Closing Shop', slug, timezone: 'UTC' }).expect(201);
  ({ id: tenantId, better_auth_org_id: orgId } = (
    await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug])
  ).rows[0]);

  manager = await signUp('manager');
  await ownerPool.query(
    `INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, 'admin', now())`,
    [randomUUID(), orgId, manager.userId],
  );

  const staff = (await request(app).post(`/tenant/${slug}/staff`).set('Cookie', owner).send({ name: 'Ana' })).body.id;
  const service = (
    await ownerPool.query(`INSERT INTO service (tenant_id, name, duration_minutes) VALUES ($1, 'Cut', 60) RETURNING id`, [tenantId])
  ).rows[0].id;
  const customer = (
    await ownerPool.query(`INSERT INTO customer (tenant_id, name, email) VALUES ($1, 'Kept Informed', $2) RETURNING id`, [
      tenantId,
      customerEmail,
    ])
  ).rows[0].id;
  future = await appointment(staff, service, customer, new Date(Date.now() + 3 * 86_400_000), futureToken);
  past = await appointment(staff, service, customer, new Date(Date.now() - 3 * 86_400_000));
});

afterAll(async () => {
  for (const t of ['appointment', 'customer', 'staff_working_hours', 'service', 'staff']) {
    await ownerPool.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
  }
  const reclaimed = (await ownerPool.query('SELECT id, better_auth_org_id AS org FROM tenant WHERE slug = $1', [slug])).rows;
  const tenants = [tenantId, ...reclaimed.map((r) => r.id)];
  const orgs = [orgId, ...reclaimed.map((r) => r.org)];
  await ownerPool.query('DELETE FROM tenant WHERE id = ANY($1)', [tenants]);
  await ownerPool.query('DELETE FROM member WHERE "organizationId" = ANY($1)', [orgs]);
  await ownerPool.query('DELETE FROM organization WHERE id = ANY($1)', [orgs]);
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
});

const close = (cookie: string, confirm: string) =>
  request(app).delete(`/tenant/${slug}`).set('Cookie', cookie).send({ confirm });

describe('closing an organization', () => {
  it('is refused to a manager, here and in the database', async () => {
    const res = await close(manager.cookie, slug);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('owner_only');
    const direct = await withContext(appPool, { tenantId, userId: manager.userId }, (c) =>
      c.query('UPDATE tenant SET archived_at = now() WHERE id = $1', [tenantId]),
    );
    expect(direct.rowCount).toBe(0);
  });

  it('needs the slug typed back', async () => {
    expect((await close(owner, 'not-it')).status).toBe(400);
  });

  it('cancels and emails future bookings, keeps past ones, and disappears', async () => {
    const res = await close(owner, slug);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: 1, emailed: 1 });

    const { rows } = await ownerPool.query('SELECT id, status FROM appointment WHERE tenant_id = $1', [tenantId]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [future]: 'CANCELLED', [past]: 'BOOKED' });
    expect(outbox.find((m) => m.to === customerEmail)?.text).toContain('has closed its booking page');

    expect((await request(app).get(`/${slug}/services`)).status).toBe(404);
    expect((await request(app).get(`/tenant/${slug}`).set('Cookie', owner)).status).toBe(404);
    // Still listed for the owner, marked closed, so they can reopen it.
    const orgs = await request(app).get('/me/organizations').set('Cookie', owner);
    expect(orgs.body.find((o: { slug: string }) => o.slug === slug).closedAt).toBeTruthy();
  });

  it('keeps the slug taken', async () => {
    const res = await request(app).post('/me/tenants').set('Cookie', manager.cookie).send({ name: 'Copycat', slug, timezone: 'UTC' });
    expect(res.status).toBe(409);
  });
});

describe('after closing', () => {
  const closedLink = () => request(app).post('/links/closed').send({ token: futureToken });
  const reopen = (cookie: string) => request(app).post(`/me/tenants/${slug}/reopen`).set('Cookie', cookie);
  const orgsOf = async (cookie: string) =>
    (await request(app).get('/me/organizations').set('Cookie', cookie)).body as { slug: string; closedAt: string | null }[];

  it("tells an old manage link's holder the organization closed", async () => {
    const res = await closedLink();
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Closing Shop');
    expect((await request(app).post('/links/closed').send({ token: 'not-a-real-token' })).status).toBe(404);
  });

  it("lists it, closed, for the owner only, and only they can reopen it", async () => {
    expect((await orgsOf(owner)).find((o) => o.slug === slug)?.closedAt).toBeTruthy();
    expect((await orgsOf(manager.cookie)).map((o) => o.slug)).not.toContain(slug);
    expect((await reopen(manager.cookie)).status).toBe(404);

    expect((await reopen(owner)).status).toBe(200);
    expect((await request(app).get(`/tenant/${slug}`).set('Cookie', owner)).status).toBe(200);
    const { rows } = await ownerPool.query('SELECT status FROM appointment WHERE id = $1', [future]);
    expect(rows[0].status).toBe('CANCELLED'); // reopening doesn't bring bookings back
    expect((await closedLink()).status).toBe(404);
    expect((await close(owner, slug)).status).toBe(200);
  });

  it('after 30 days, cannot be reopened and the slug is free again', async () => {
    await ownerPool.query("UPDATE tenant SET archived_at = now() - interval '31 days' WHERE id = $1", [tenantId]);
    expect((await reopen(owner)).status).toBe(404);
    expect((await orgsOf(owner)).map((o) => o.slug)).not.toContain(slug);

    const res = await request(app).post('/me/tenants').set('Cookie', manager.cookie).send({ name: 'New Shop', slug, timezone: 'UTC' });
    expect(res.status).toBe(201);
    const { rows } = await ownerPool.query('SELECT slug FROM tenant WHERE id = $1', [tenantId]);
    expect(rows[0].slug).toMatch(new RegExp(`^${slug}--closed-[0-9a-f]{32}$`));
    // The old link still says the old organization closed, not the new one's name.
    expect((await closedLink()).body.name).toBe('Closing Shop');
  });
});
