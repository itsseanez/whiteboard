import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

const run = randomUUID().slice(0, 8);
const slug = `del-${run}`;
const email = `del-owner-${run}@test.example`;
const TZ = 'Europe/Vienna';
const date = Temporal.Now.plainDateISO(TZ).add({ days: 7 }).toString();
const at = (hhmm: string) =>
  Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: TZ, plainTime: Temporal.PlainTime.from(hhmm) }).toInstant().toString();

let cookie = '';
const send = (method: 'get' | 'post' | 'put' | 'delete', path: string, body?: object) => {
  const r = request(app)[method](`/tenant/${slug}${path}`).set('Cookie', cookie);
  return body ? r.send(body) : r;
};
const allWeek = (start: string, end: string) => [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start, end }));

async function staffWithService(name: string) {
  const staff = (await send('post', '/staff', { name })).body.id as string;
  await send('put', `/staff/${staff}/hours`, { hours: allWeek('09:00', '17:00') });
  const service = (await send('post', '/services', { name: `${name} service`, durationMinutes: 30, staffIds: [staff] })).body.id as string;
  return { staff, service };
}

const book = (serviceId: string, staffId: string, hhmm: string) =>
  request(app)
    .post(`/${slug}/appointments`)
    .send({ serviceId, staffId, startsAt: at(hhmm), customer: { name: 'C', email: `c-${run}-${hhmm.replace(':', '')}@test.example` } });

beforeAll(async () => {
  const signUp = await request(app).post('/api/auth/sign-up/email').send({ name: 'Del', email, password: 'test-password-123' });
  cookie = (signUp.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
  expect((await request(app).post('/me/tenants').set('Cookie', cookie).send({ name: 'Del', slug, timezone: TZ })).status).toBe(201);
  await send('put', '/business-hours', { hours: allWeek('08:00', '20:00') });
});

afterAll(async () => {
  const { rows } = await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug]);
  const t = rows[0];
  if (t) {
    for (const table of ['appointment', 'customer', 'staff_service', 'service_resource', 'staff_working_hours', 'business_hours', 'time_off', 'service', 'staff', 'resource']) {
      await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [t.id]);
    }
    await ownerPool.query('DELETE FROM tenant WHERE id = $1', [t.id]);
    await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [t.better_auth_org_id]);
    await ownerPool.query('DELETE FROM organization WHERE id = $1', [t.better_auth_org_id]);
  }
  await ownerPool.query('DELETE FROM "user" WHERE email = $1', [email]);
  await ownerPool.end();
});

describe('deleting staff and services', () => {
  it('refuses while future bookings exist, then archives once they are cancelled', async () => {
    const { staff, service } = await staffWithService('Ana');
    const booked = await book(service, staff, '10:00');
    expect(booked.status).toBe(201);

    const refused = await send('delete', `/staff/${staff}`);
    expect(refused.status).toBe(409);
    expect(refused.body).toEqual({ error: 'has_future_appointments', count: 1 });

    await send('post', `/appointments/${booked.body.appointmentId}/cancel`, {});
    expect((await send('delete', `/staff/${staff}`)).status).toBe(204);

    expect((await send('get', '/staff')).body.map((s: { id: string }) => s.id)).not.toContain(staff);
    const svc = (await send('get', '/services')).body.find((s: { id: string }) => s.id === service);
    expect(svc.staffIds).toEqual([]);
    expect((await book(service, staff, '11:00')).status).toBe(409);
    expect((await send('put', `/staff/${staff}/hours`, { hours: [] })).status).toBe(404);
    expect((await send('delete', `/staff/${staff}`)).status).toBe(404);

    // The cancelled appointment keeps pointing at the archived row.
    const { rows } = await ownerPool.query('SELECT staff_id FROM appointment WHERE id = $1', [booked.body.appointmentId]);
    expect(rows[0].staff_id).toBe(staff);
  });

  it('hides a deleted service from owners and customers', async () => {
    const { staff, service } = await staffWithService('Ben');
    expect((await send('delete', `/services/${service}`)).status).toBe(204);
    expect((await send('get', '/services')).body.map((s: { id: string }) => s.id)).not.toContain(service);
    const catalog = await request(app).get(`/${slug}/services`);
    expect(catalog.body.services.map((s: { id: string }) => s.id)).not.toContain(service);
    expect((await request(app).get(`/${slug}/availability`).query({ serviceId: service, from: date })).status).toBe(404);
    expect((await book(service, staff, '10:00')).status).toBe(404);
    expect((await send('put', `/services/${service}`, { name: 'Back', durationMinutes: 30 })).status).toBe(404);
  });

  it('refuses an archived staff member in a service', async () => {
    const { staff } = await staffWithService('Cat');
    await send('delete', `/staff/${staff}`);
    const res = await send('post', '/services', { name: 'Needs Cat', durationMinutes: 30, staffIds: [staff] });
    expect(res.status).toBe(400);
  });

  it('a booking racing an archive loses', async () => {
    const { staff, service } = await staffWithService('Dan');
    // Hold the archive open: row locked and marked, not yet committed.
    const client = await ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM staff WHERE id = $1 FOR UPDATE', [staff]);
      await client.query('UPDATE staff SET archived_at = now() WHERE id = $1', [staff]);
      // The booking sees Dan as available, then its insert waits on the lock.
      const pending = book(service, staff, '12:00').then((r) => r);
      await new Promise((r) => setTimeout(r, 400));
      await client.query('COMMIT');
      const res = await pending;
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('slot_not_available');
    } finally {
      client.release();
    }
    const { rows } = await ownerPool.query("SELECT count(*)::int AS n FROM appointment WHERE staff_id = $1 AND status = 'BOOKED'", [staff]);
    expect(rows[0].n).toBe(0);
  });
});
