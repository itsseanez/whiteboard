import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { outbox } from '../src/lib/mailer.js';
import { appPool } from '../src/db.js';
import { withContext } from '../src/withContext.js';

// Time off from the app: owners and managers for anyone, staff for themselves.
// The row checks also go straight at the database as whiteboard_app, because
// RLS is what decides, not the routes.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });

const run = randomUUID().slice(0, 8);
const slug = `timeoff-${run}`;
const emails: string[] = [];
const email = (label: string) => {
  const e = `${label}-${run}@test.example`;
  emails.push(e);
  return e;
};

let owner = '';
let tenantId = '';
let orgId = '';
let anna = '';
let ben = '';
let service = '';
let annaLogin: { cookie: string; userId: string };
let benLogin: { cookie: string; userId: string };
let manager: { cookie: string; userId: string };

function cookieOf(res: request.Response): string {
  const found = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
    c.startsWith('better-auth.session_token='),
  );
  if (!found) throw new Error(`No session (${res.status})`);
  return found;
}

async function signUp(address: string) {
  const res = await request(app)
    .post('/api/auth/sign-up/email')
    .send({ name: address.split('-')[0], email: address, password: 'test-password-123' });
  return { cookie: cookieOf(res), userId: res.body.user.id as string };
}

const api = {
  get: (path: string, c: string) => request(app).get(`/tenant/${slug}${path}`).set('Cookie', c),
  post: (path: string, body: object, c: string) => request(app).post(`/tenant/${slug}${path}`).set('Cookie', c).send(body),
  delete: (path: string, c: string) => request(app).delete(`/tenant/${slug}${path}`).set('Cookie', c),
};

async function invitedAndAccepted(label: string, role: 'staff' | 'manager', staffId: string | null) {
  const address = email(label);
  const sent = await api.post('/invitations', { email: address, role, ...(staffId ? { staffId } : {}) }, owner);
  expect(sent.status).toBe(201);
  const user = await signUp(address);
  const mail = [...outbox].reverse().find((m) => m.to === address);
  const id = mail?.text.match(/\/invite\/([^?\s]+)/)?.[1];
  const accepted = await request(app).post(`/me/invitations/${id}/accept`).set('Cookie', user.cookie);
  expect(accepted.status).toBe(200);
  return user;
}

async function rowExists(id: string): Promise<boolean> {
  return (await ownerPool.query('SELECT 1 FROM time_off WHERE id = $1', [id])).rowCount === 1;
}

beforeAll(async () => {
  ({ cookie: owner } = await signUp(email('owner')));
  const res = await request(app)
    .post('/me/tenants')
    .set('Cookie', owner)
    .send({ name: 'Time Off Test', slug, timezone: 'Europe/Vienna' });
  if (res.status !== 201) throw new Error(`Provisioning failed (${res.status})`);
  ({ id: tenantId, better_auth_org_id: orgId } = (
    await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug])
  ).rows[0]);

  anna = (await api.post('/staff', { name: 'Anna' }, owner)).body.id;
  ben = (await api.post('/staff', { name: 'Ben' }, owner)).body.id;
  annaLogin = await invitedAndAccepted('anna', 'staff', anna);
  benLogin = await invitedAndAccepted('ben', 'staff', ben);
  manager = await invitedAndAccepted('mgr', 'manager', null);

  service = (
    await ownerPool.query(`INSERT INTO service (tenant_id, name, duration_minutes) VALUES ($1, 'Cut', 60) RETURNING id`, [tenantId])
  ).rows[0].id;
  await ownerPool.query(`INSERT INTO staff_service (staff_id, service_id, tenant_id) VALUES ($1, $2, $3)`, [ben, service, tenantId]);
  await ownerPool.query(
    `INSERT INTO business_hours (tenant_id, weekday, opens_at, closes_at) VALUES ($1, 1, '09:00', '17:00')`,
    [tenantId],
  );
  await ownerPool.query(
    `INSERT INTO staff_working_hours (staff_id, tenant_id, weekday, start_time, end_time) VALUES ($1, $2, 1, '09:00', '17:00')`,
    [ben, tenantId],
  );
});

afterAll(async () => {
  for (const table of ['appointment', 'customer', 'staff_service', 'service_resource', 'staff_working_hours', 'business_hours', 'time_off']) {
    await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  for (const table of ['service', 'staff', 'resource']) {
    await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await ownerPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  await ownerPool.query('DELETE FROM invitation WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM organization WHERE id = $1', [orgId]);
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
});

describe('owners and managers', () => {
  it("add time off for anyone, read in the organization's zone", async () => {
    const res = await api.post('/time-off', { staffId: ben, startDate: '2031-12-24', endDate: '2031-12-26', reason: 'family' }, owner);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ staffId: ben, startsAt: '2031-12-23T23:00:00Z', endsAt: '2031-12-26T23:00:00Z' });

    const list = await api.get('/time-off', owner);
    expect(list.body.timeZone).toBe('Europe/Vienna');
    expect(list.body.timeOff).toContainEqual(
      expect.objectContaining({ id: res.body.id, staffName: 'Ben', reason: 'family' }),
    );
  });

  it('managers too', async () => {
    const res = await api.post('/time-off', { staffId: anna, startDate: '2031-11-03' }, manager.cookie);
    expect(res.status).toBe(201);
    expect((await api.delete(`/time-off/${res.body.id}`, manager.cookie)).status).toBe(204);
  });

  it('say how many booked appointments fall inside it', async () => {
    const customer = (
      await ownerPool.query(`INSERT INTO customer (tenant_id, name, email) VALUES ($1, 'Carla', $2) RETURNING id`, [
        tenantId,
        `carla-${run}@customer.example`,
      ])
    ).rows[0].id;
    await ownerPool.query(
      `INSERT INTO appointment (tenant_id, staff_id, service_id, customer_id, starts_at, ends_at, blocked_starts_at, blocked_ends_at, manage_token_hash)
       VALUES ($1, $2, $3, $4, '2031-03-03T09:00Z', '2031-03-03T10:00Z', '2031-03-03T09:00Z', '2031-03-03T10:00Z', $5)`,
      [tenantId, ben, service, customer, randomBytes(32).toString('hex')],
    );
    const res = await api.post('/time-off', { staffId: ben, startDate: '2031-03-03' }, owner);
    expect(res.body.overlappingAppointments).toBe(1);
  });

  it("still see staff time off in the calendar's availability", async () => {
    // Monday 6 January 2031, Vienna is +01:00. Ben is off 10:00–12:00.
    await api.post('/time-off', { staffId: ben, startDate: '2031-01-06', startTime: '10:00', endTime: '12:00' }, owner);
    const res = await api.get(`/availability/explain?serviceId=${service}&from=2031-01-06`, owner);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const starts: string[] = res.body.days[0].slots.map((s: { startsAt: string }) => s.startsAt);
    expect(starts).toContain('2031-01-06T08:00:00Z'); // 09:00
    expect(starts).toContain('2031-01-06T11:00:00Z'); // 12:00
    expect(starts.filter((s) => s > '2031-01-06T08:00:00Z' && s < '2031-01-06T11:00:00Z')).toEqual([]);
  });

  it('refuse a staff member who is archived or in another organization', async () => {
    const elsewhere = 'a2222222-2222-2222-2222-222222222222'; // Studio Wien's Anna
    expect((await api.post('/time-off', { staffId: elsewhere, startDate: '2031-05-01' }, owner)).status).toBe(404);
  });

  it('refuse bad input with 400', async () => {
    expect((await api.post('/time-off', { staffId: ben }, owner)).status).toBe(400);
    expect((await api.post('/time-off', { staffId: ben, startDate: '2031-05-02', endDate: '2031-05-01' }, owner)).status).toBe(400);
    expect((await api.post('/time-off', { staffId: 'ben', startDate: '2031-05-01' }, owner)).status).toBe(400);
    // An owner with no staff row of their own has to say who.
    expect((await api.post('/time-off', { startDate: '2031-05-01' }, owner)).status).toBe(400);
  });
});

describe('staff', () => {
  it('add their own time off without naming themselves', async () => {
    const res = await api.post('/time-off', { startDate: '2031-08-10', endDate: '2031-08-20', reason: 'doctor' }, annaLogin.cookie);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.staffId).toBe(anna);
  });

  it("cannot add time off for a colleague, and nothing is written", async () => {
    const before = (await ownerPool.query('SELECT count(*)::int AS n FROM time_off WHERE staff_id = $1', [ben])).rows[0].n;
    const res = await api.post('/time-off', { staffId: ben, startDate: '2031-09-01' }, annaLogin.cookie);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'own_time_off_only' });
    const after = (await ownerPool.query('SELECT count(*)::int AS n FROM time_off WHERE staff_id = $1', [ben])).rows[0].n;
    expect(after).toBe(before);
  });

  it("see only their own, so a colleague's reason stays private", async () => {
    const list = await api.get('/time-off', annaLogin.cookie);
    expect(list.status).toBe(200);
    expect(list.body.timeOff.length).toBeGreaterThan(0);
    for (const entry of list.body.timeOff) expect(entry.staffId).toBe(anna);

    // Not just the route: as whiteboard_app, with Ben's user, Anna's rows don't exist.
    const rows = await withContext(appPool, { tenantId, userId: benLogin.userId }, (c) =>
      c.query<{ staff_id: string }>('SELECT staff_id, reason FROM time_off'),
    );
    expect(rows.rows.every((r) => r.staff_id === ben)).toBe(true);
  });

  it("cannot remove a colleague's time off, but can remove their own", async () => {
    const bens = (await api.post('/time-off', { staffId: ben, startDate: '2031-10-01' }, owner)).body.id;
    expect((await api.delete(`/time-off/${bens}`, annaLogin.cookie)).status).toBe(404);
    expect(await rowExists(bens)).toBe(true);

    const own = (await api.post('/time-off', { startDate: '2031-10-02' }, annaLogin.cookie)).body.id;
    expect((await api.delete(`/time-off/${own}`, annaLogin.cookie)).status).toBe(204);
    expect(await rowExists(own)).toBe(false);
  });

  it('see nothing with no user set', async () => {
    const rows = await withContext(appPool, { tenantId }, (c) => c.query('SELECT 1 FROM time_off'));
    expect(rows.rowCount).toBe(0);
  });
});
