import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });

const run = randomUUID().slice(0, 8);
const slug = `cal-${run}`;
const email = `cal-owner-${run}@test.example`;
const TZ = 'America/New_York';
const date = Temporal.Now.plainDateISO(TZ).add({ days: 7 }).toString();

let cookie = '';
let ana = '';
let cut = '';

const get = (path: string, query: Record<string, string> = {}) =>
  request(app).get(`/tenant/${slug}${path}`).query(query).set('Cookie', cookie);
const post = (path: string, body: object) => request(app).post(`/tenant/${slug}${path}`).set('Cookie', cookie).send(body);
const put = (path: string, body: object) => request(app).put(`/tenant/${slug}${path}`).set('Cookie', cookie).send(body);

// A local wall time on `date`, as the instant the API speaks.
const at = (hhmm: string) =>
  Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: TZ, plainTime: Temporal.PlainTime.from(hhmm) }).toInstant().toString();

beforeAll(async () => {
  const signUp = await request(app).post('/api/auth/sign-up/email').send({ name: 'Cal', email, password: 'test-password-123' });
  cookie = (signUp.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
  expect((await request(app).post('/me/tenants').set('Cookie', cookie).send({ name: 'Cal', slug, timezone: TZ })).status).toBe(201);

  const week = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '08:00', end: '20:00' }));
  await put('/business-hours', { hours: week });
  ana = (await post('/staff', { name: 'Ana' })).body.id;
  await put(`/staff/${ana}/hours`, { hours: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '09:00', end: '12:00' })) });
  cut = (await post('/services', { name: 'Cut', durationMinutes: 45, staffIds: [ana] })).body.id;
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

describe('owner calendar', () => {
  it('explains a time outside working hours', async () => {
    const res = await get('/availability/explain', { serviceId: cut, from: date });
    expect(res.status).toBe(200);
    const day = res.body.days[0];
    expect(day.status).toBe('open');
    const eight = day.excluded.find((e: { startsAt: string }) => e.startsAt === at('08:00'));
    expect(eight.reason).toEqual([{ reason: 'outsideWorkingHours', staffId: ana }]);
    expect(day.slots[0].startsAt).toBe(at('09:00'));
  });

  it('books, shows, explains, moves and cancels an appointment', async () => {
    const booked = await post('/appointments', {
      serviceId: cut,
      staffId: ana,
      startsAt: at('09:00'),
      customer: { name: 'Walk In', email: `walkin-${run}@test.example`, phone: '555-0100' },
    });
    expect(booked.status).toBe(201);
    expect(booked.body.manageToken).toBeUndefined();
    const id = booked.body.appointmentId;

    const cal = await get('/calendar', { from: date });
    expect(cal.status).toBe(200);
    expect(cal.body.staff.map((s: { name: string }) => s.name)).toEqual(['Ana']);
    expect(cal.body.appointments).toEqual([
      expect.objectContaining({ id, staffId: ana, serviceName: 'Cut', customer: { name: 'Walk In', email: `walkin-${run}@test.example`, phone: '555-0100' } }),
    ]);

    const explain = await get('/availability/explain', { serviceId: cut, from: date });
    const nine = explain.body.days[0].excluded.find((e: { startsAt: string }) => e.startsAt === at('09:00'));
    expect(nine.reason[0]).toMatchObject({ reason: 'busy', staffId: ana, busyInterval: { appointmentId: id } });

    // The engine refuses 11:30 (would run past Ana's noon finish), so the owner can't book it either.
    const refused = await post('/appointments', {
      serviceId: cut,
      staffId: ana,
      startsAt: at('11:30'),
      customer: { name: 'Late', email: `late-${run}@test.example` },
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('slot_not_available');

    const moved = await post(`/appointments/${id}/reschedule`, { startsAt: at('10:00') });
    expect(moved.status).toBe(200);
    expect(moved.body.startsAt).toBe(at('10:00'));

    const cancelled = await post(`/appointments/${id}/cancel`, {});
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelled: true });
    expect((await post(`/appointments/${id}/cancel`, {})).body.cancelled).toBe(false);
    expect((await get('/calendar', { from: date })).body.appointments).toEqual([]);
  });

  it('refuses a range over seven days', async () => {
    const through = Temporal.PlainDate.from(date).add({ days: 7 }).toString();
    expect((await get('/calendar', { from: date, through })).status).toBe(400);
  });

  it("answers 404 for another organization's appointment id", async () => {
    const { rows } = await ownerPool.query(
      `SELECT a.id FROM appointment a JOIN tenant t ON t.id = a.tenant_id WHERE t.slug <> $1 LIMIT 1`,
      [slug],
    );
    const foreign = rows[0]?.id ?? randomUUID();
    expect((await post(`/appointments/${foreign}/cancel`, {})).status).toBe(404);
  });
});
