import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

// A fresh organization per run, set up through the owner endpoints exactly as
// the definition of done describes, then booked from the public API.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });

const run = randomUUID().slice(0, 8);
const slug = `owner-${run}`;
const emails: string[] = [];
const DEMO_STAFF_OTHER_TENANT = 'a1111111-1111-1111-1111-111111111111'; // seeded, Marina's
const TZ = 'Europe/Vienna';

let cookie = '';

async function signUp(label: string): Promise<{ cookie: string; userId: string }> {
  const email = `owner-${label}-${run}@test.example`;
  emails.push(email);
  const res = await request(app)
    .post('/api/auth/sign-up/email')
    .send({ name: label, email, password: 'test-password-123' });
  const found = (res.headers['set-cookie'] as unknown as string[])?.find((c) =>
    c.startsWith('better-auth.session_token='),
  );
  if (!found) throw new Error(`Sign-up failed (${res.status})`);
  return { cookie: found, userId: res.body.user.id };
}

const api = {
  get: (path: string, c = cookie) => request(app).get(`/tenant/${slug}${path}`).set('Cookie', c),
  post: (path: string, body: object, c = cookie) =>
    request(app).post(`/tenant/${slug}${path}`).set('Cookie', c).send(body),
  put: (path: string, body: object, c = cookie) =>
    request(app).put(`/tenant/${slug}${path}`).set('Cookie', c).send(body),
  patch: (path: string, body: object, c = cookie) =>
    request(app).patch(`/tenant/${slug}${path}`).set('Cookie', c).send(body),
};

beforeAll(async () => {
  ({ cookie } = await signUp('owner'));
  const res = await request(app)
    .post('/me/tenants')
    .set('Cookie', cookie)
    .send({ name: 'Owner Test', slug, timezone: TZ });
  if (res.status !== 201) throw new Error(`Provisioning failed (${res.status})`);
});

afterAll(async () => {
  const { rows } = await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug]);
  const tenant = rows[0];
  if (tenant) {
    for (const table of ['appointment', 'customer', 'staff_service', 'service_resource', 'staff_working_hours', 'business_hours', 'time_off']) {
      await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenant.id]);
    }
    for (const table of ['service', 'staff', 'resource']) {
      await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenant.id]);
    }
    await ownerPool.query('DELETE FROM tenant WHERE id = $1', [tenant.id]);
    await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [tenant.better_auth_org_id]);
    await ownerPool.query('DELETE FROM organization WHERE id = $1', [tenant.better_auth_org_id]);
  }
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
});

describe('who may use the owner endpoints', () => {
  it('refuses a member who is not an owner', async () => {
    const member = await signUp('member');
    const { rows } = await ownerPool.query('SELECT better_auth_org_id AS org FROM tenant WHERE slug = $1', [slug]);
    await ownerPool.query(
      `INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, 'member', now())`,
      [randomUUID(), rows[0].org, member.userId],
    );
    const res = await api.get('/staff', member.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('owner_only');
  });

  it("hides the tenant from another organization's owner", async () => {
    const signIn = await request(app)
      .post('/api/auth/sign-in/email')
      .send({ email: 'marina@marinascuts.example', password: 'demo-password-123' });
    const marina = (signIn.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('better-auth.session_token='),
    )!;
    expect((await api.get('/staff', marina)).status).toBe(404);
    expect((await api.post('/staff', { name: 'Intruder' }, marina)).status).toBe(404);
  });

  it('requires a session', async () => {
    expect((await request(app).get(`/tenant/${slug}/staff`)).status).toBe(401);
  });
});

describe('hours validation', () => {
  it('accepts split shifts and an end of 00:00, and returns them sorted', async () => {
    const res = await api.put('/business-hours', {
      hours: [
        { weekday: 1, start: '15:00', end: '00:00' },
        { weekday: 1, start: '09:00', end: '12:00' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.hours).toEqual([
      { weekday: 1, start: '09:00', end: '12:00' },
      { weekday: 1, start: '15:00', end: '00:00' },
    ]);
    expect((await api.get('/business-hours')).body.hours).toEqual(res.body.hours);
  });

  it.each([
    ['overlapping ranges', [{ weekday: 2, start: '09:00', end: '13:00' }, { weekday: 2, start: '12:00', end: '17:00' }]],
    ['reversed range', [{ weekday: 2, start: '17:00', end: '09:00' }]],
    ['zero-length range', [{ weekday: 2, start: '09:00', end: '09:00' }]],
    ['midnight to midnight', [{ weekday: 2, start: '00:00', end: '00:00' }]],
    ['weekday 0', [{ weekday: 0, start: '09:00', end: '17:00' }]],
    ['bad time', [{ weekday: 2, start: '9:00', end: '17:00' }]],
  ])('refuses %s and leaves the old week in place', async (_label, hours) => {
    const before = (await api.get('/business-hours')).body.hours;
    const res = await api.put('/business-hours', { hours });
    expect(res.status).toBe(400);
    expect((await api.get('/business-hours')).body.hours).toEqual(before);
  });
});

describe('services', () => {
  it('refuses a staff member from another tenant', async () => {
    const res = await api.post('/services', {
      name: 'Borrowed',
      durationMinutes: 30,
      staffIds: [DEMO_STAFF_OTHER_TENANT],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unknown_staff_or_resource');
    const names = (await api.get('/services')).body.map((s: { name: string }) => s.name);
    expect(names).not.toContain('Borrowed');
  });

  it('refuses a zero duration on the server and in the database', async () => {
    expect((await api.post('/services', { name: 'Nothing', durationMinutes: 0 })).status).toBe(400);
    const { rows } = await ownerPool.query('SELECT id FROM tenant WHERE slug = $1', [slug]);
    await expect(
      ownerPool.query(
        `INSERT INTO service (tenant_id, name, duration_minutes) VALUES ($1, 'Raw', 0)`,
        [rows[0].id],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('returns 404 for an id from another tenant', async () => {
    const res = await api.put(`/staff/${DEMO_STAFF_OTHER_TENANT}/hours`, { hours: [] });
    expect(res.status).toBe(404);
  });
});

describe('the definition of done, through the API', () => {
  it('sets up two staff with awkward hours, a resource and two services, then books both', async () => {
    // Every day open 08:00–20:00, so staff hours decide availability.
    const week = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '08:00', end: '20:00' }));
    expect((await api.put('/business-hours', { hours: week })).status).toBe(200);

    const ana = (await api.post('/staff', { name: 'Ana' })).body;
    const ben = (await api.post('/staff', { name: 'Ben' })).body;
    expect((await api.patch(`/staff/${ben.id}`, { name: 'Benedikt' })).status).toBe(204);

    const split = [1, 2, 3, 4, 5, 6, 7].flatMap((weekday) => [
      { weekday, start: '09:15', end: '11:45' },
      { weekday, start: '16:30', end: '19:10' },
    ]);
    const lateOnly = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '13:20', end: '18:50' }));
    expect((await api.put(`/staff/${ana.id}/hours`, { hours: split })).status).toBe(200);
    expect((await api.put(`/staff/${ben.id}/hours`, { hours: lateOnly })).status).toBe(200);

    const wash = (await api.post('/resources', { name: 'Wash station' })).body;
    const cut = (
      await api.post('/services', { name: 'Cut', durationMinutes: 45, staffIds: [ana.id, ben.id] })
    ).body;
    const color = (
      await api.post('/services', {
        name: 'Color',
        durationMinutes: 90,
        bufferAfterMinutes: 15,
        staffIds: [ana.id],
        resourceIds: [wash.id],
      })
    ).body;

    const staff = (await api.get('/staff')).body;
    expect(staff.map((s: { name: string }) => s.name)).toEqual(['Ana', 'Benedikt']);
    expect(staff[0].hours).toHaveLength(14);
    const services = (await api.get('/services')).body;
    expect(services.find((s: { id: string }) => s.id === color.id).resourceIds).toEqual([wash.id]);

    // Narrowing the cut to Ben replaces the links rather than adding to them.
    const updated = await api.put(`/services/${cut.id}`, { name: 'Cut', durationMinutes: 45, staffIds: [ben.id] });
    expect(updated.body.staffIds).toEqual([ben.id]);

    // Public side: the catalogue shows both, and each can be booked.
    const catalog = await request(app).get(`/${slug}/services`);
    expect(catalog.body.services.map((s: { name: string }) => s.name).sort()).toEqual(['Color', 'Cut']);

    const date = Temporal.Now.plainDateISO(TZ).add({ days: 7 }).toString();
    for (const [service, staffId] of [[cut, ben.id], [color, ana.id]] as const) {
      const avail = await request(app)
        .get(`/${slug}/availability`)
        .query({ serviceId: service.id, from: date, staffId });
      expect(avail.status).toBe(200);
      const day = avail.body.days[0];
      expect(day.status).toBe('open');
      expect(day.slots.length).toBeGreaterThan(0);

      const booked = await request(app)
        .post(`/${slug}/appointments`)
        .send({
          serviceId: service.id,
          staffId,
          startsAt: day.slots[0].startsAt,
          customer: { name: 'Test Customer', email: `customer-${run}@test.example` },
        });
      expect(booked.status).toBe(201);
    }
  });
});
