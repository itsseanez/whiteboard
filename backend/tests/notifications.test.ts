import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { appPool } from '../src/db.js';
import { withContext } from '../src/withContext.js';

// The inbox: who's told what, by the database, and that each person reads
// and marks only their own.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);
const slug = `inbox-${run}`;
const emails: string[] = [];

type Login = { cookie: string; userId: string };
let owner: Login;
let manager: Login;
let ana: Login;
let tenantId = '';
let orgId = '';
let anaStaff = '';
let service = '';
let customer = '';
let bookings = 0;

async function signUp(label: string): Promise<Login> {
  const email = `${label}-${run}@test.example`;
  emails.push(email);
  const res = await request(app).post('/api/auth/sign-up/email').send({ name: label, email, password: 'test-password-123' });
  const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
  return { cookie, userId: res.body.user.id };
}

async function join(user: Login, role: 'admin' | 'member') {
  await ownerPool.query(`INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())`, [randomUUID(), orgId, user.userId, role]);
}

const inbox = (user: Login, query: Record<string, string | number> = {}) =>
  request(app).get('/me/notifications').query(query).set('Cookie', user.cookie);

async function kinds(user: Login): Promise<string[]> {
  return (await inbox(user, { pageSize: 50 })).body.items.map((n: { kind: string }) => n.kind);
}

/** As someone, so the trigger sees who did it; no one means the customer. */
async function as(userId: string | null, sql: string, params: unknown[]) {
  const client = await ownerPool.connect();
  try {
    await client.query('BEGIN');
    if (userId) await client.query(`SELECT set_config('app.user_id', $1, true)`, [userId]);
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function book(by: string | null): Promise<string> {
  bookings += 1;
  const starts = new Date(Date.now() + (3 + bookings) * 86_400_000);
  const ends = new Date(starts.getTime() + 30 * 60_000);
  const { rows } = await as(
    by,
    `INSERT INTO appointment (tenant_id, staff_id, service_id, customer_id, starts_at, ends_at, blocked_starts_at, blocked_ends_at, manage_token_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7) RETURNING id`,
    [tenantId, anaStaff, service, customer, starts, ends, randomBytes(32).toString('hex')],
  );
  return rows[0].id;
}

beforeAll(async () => {
  owner = await signUp('owner');
  await request(app).post('/me/tenants').set('Cookie', owner.cookie).send({ name: 'Inbox Test', slug, timezone: 'UTC' }).expect(201);
  ({ id: tenantId, better_auth_org_id: orgId } = (await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug])).rows[0]);
  manager = await signUp('manager');
  await join(manager, 'admin');
  ana = await signUp('ana');
  await join(ana, 'member');
  anaStaff = (await request(app).post(`/tenant/${slug}/staff`).set('Cookie', owner.cookie).send({ name: 'Ana' })).body.id;
  await ownerPool.query('UPDATE staff SET user_id = $1 WHERE id = $2', [ana.userId, anaStaff]);
  service = (await ownerPool.query(`INSERT INTO service (tenant_id, name, duration_minutes) VALUES ($1, 'Cut', 30) RETURNING id`, [tenantId])).rows[0].id;
  customer = (await ownerPool.query(`INSERT INTO customer (tenant_id, name, email) VALUES ($1, 'Cleo', $2) RETURNING id`, [tenantId, `cleo-${run}@customer.example`])).rows[0].id;
  await ownerPool.query('DELETE FROM notification WHERE tenant_id = $1', [tenantId]); // joining, so far
});

afterAll(async () => {
  for (const table of ['appointment', 'time_off', 'customer', 'service', 'staff']) await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  await ownerPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM organization WHERE id = $1', [orgId]);
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
});

describe('who is told', () => {
  it('a customer booking tells the stylist and the owners and managers, once each', async () => {
    await book(null);
    expect(await kinds(ana)).toEqual(['appointment_booked']);
    expect(await kinds(owner)).toEqual(['appointment_booked']);
    expect(await kinds(manager)).toEqual(['appointment_booked']);
    const item = (await inbox(ana)).body.items[0];
    expect(item).toMatchObject({ category: 'appointments', link: `/manage/${slug}/me`, read: false, data: { customer: 'Cleo', service: 'Cut', byCustomer: true } });
  });

  it("an owner's own change tells the stylist, not the owners and managers", async () => {
    const id = await book(owner.userId);
    await as(owner.userId, `UPDATE appointment SET status = 'CANCELLED' WHERE id = $1`, [id]);
    expect(await kinds(ana)).toEqual(['appointment_cancelled', 'appointment_booked', 'appointment_booked']);
    expect(await kinds(owner)).toEqual(['appointment_booked']);
  });

  it('a time-off request tells owners and managers, and the decision tells the stylist', async () => {
    const asked = await request(app).post(`/tenant/${slug}/time-off`).set('Cookie', ana.cookie).send({ startDate: '2031-06-01', reason: 'wedding' });
    expect(asked.status).toBe(201);
    expect((await kinds(owner))[0]).toBe('time_off_requested');
    expect((await kinds(manager))[0]).toBe('time_off_requested');
    expect((await inbox(owner)).body.items[0].data).toMatchObject({ staff: 'Ana', reason: 'wedding' });
    expect((await kinds(ana))[0]).toBe('appointment_cancelled'); // not told about her own request

    await request(app).post(`/tenant/${slug}/time-off/${asked.body.id}/approve`).set('Cookie', manager.cookie).expect(200);
    const decided = (await inbox(ana)).body.items[0];
    expect(decided).toMatchObject({ kind: 'time_off_approved', category: 'time_off' });
    expect(decided.data).not.toHaveProperty('reason');
  });

  it('someone joining tells the owners and managers', async () => {
    const newcomer = await signUp('newcomer');
    await join(newcomer, 'member');
    expect((await inbox(owner)).body.items[0]).toMatchObject({ kind: 'member_joined', category: 'team', data: { person: 'newcomer', role: 'member' } });
    expect(await kinds(newcomer)).toEqual([]);
  });
});

describe('reading the inbox', () => {
  it('pages, filters, counts unread, and marks read', async () => {
    const all = (await inbox(ana, { pageSize: 50 })).body;
    expect(all.total).toBe(4);
    expect(all.unread).toBe(4);

    const second = (await inbox(ana, { pageSize: 1, page: 2 })).body;
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).toBe(all.items[1].id);

    const timeOff = (await inbox(ana, { category: 'time_off' })).body;
    expect(timeOff.items.map((n: { kind: string }) => n.kind)).toEqual(['time_off_approved']);

    await request(app).post(`/me/notifications/${all.items[0].id}/read`).set('Cookie', ana.cookie).expect(204);
    const unread = (await inbox(ana, { status: 'unread' })).body;
    expect(unread.unread).toBe(3);
    expect(unread.items.map((n: { id: string }) => n.id)).not.toContain(all.items[0].id);

    expect((await request(app).post('/me/notifications/read-all').set('Cookie', ana.cookie)).body).toEqual({ marked: 3 });
    expect((await inbox(ana)).body.unread).toBe(0);
  });

  it("can't read or mark someone else's", async () => {
    const owners = (await inbox(owner)).body.items[0].id;
    expect((await request(app).post(`/me/notifications/${owners}/read`).set('Cookie', ana.cookie)).status).toBe(404);
    expect((await inbox(owner)).body.items[0].read).toBe(false);

    // Straight at the database too: Ana's user sees only Ana's rows, and the app can't write any.
    const result = await withContext(appPool, { userId: ana.userId }, async (c) => {
      const seen = await c.query<{ user_id: string }>('SELECT user_id FROM notification');
      const inserted = await c
        .query(`INSERT INTO notification (user_id, tenant_id, kind, category, link, data) VALUES ($1, $2, 'member_joined', 'team', '/', '{}')`, [owner.userId, tenantId])
        .then(() => 'inserted', (e: { code?: string }) => e.code);
      return { users: new Set(seen.rows.map((r) => r.user_id)), inserted };
    });
    expect([...result.users]).toEqual([ana.userId]);
    expect(result.inserted).toBe('42501');
  });

  it('rejects bad filters', async () => {
    expect((await inbox(ana, { category: 'everything' })).status).toBe(400);
    expect((await inbox(ana, { pageSize: 500 })).status).toBe(400);
    expect((await request(app).get('/me/notifications')).status).toBe(401);
  });
});
