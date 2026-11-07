import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { appPool } from '../src/db.js';
import { withContext } from '../src/withContext.js';

// Appointment history, written by a trigger: a customer books, the owner
// moves it, the customer cancels from their link. Each line says who.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);
const slug = `history-${run}`;
const emails: string[] = [];
const DAY = '2031-02-03'; // a Monday

let owner = { cookie: '', userId: '' };
let tenantId = '';
let orgId = '';
let ana = '';
let service = '';

function cookieOf(res: request.Response): string {
  return (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
}

async function signUp(label: string) {
  const email = `${label}-${run}@test.example`;
  emails.push(email);
  const res = await request(app).post('/api/auth/sign-up/email').send({ name: 'Hanna Owner', email, password: 'test-password-123' });
  return { cookie: cookieOf(res), userId: res.body.user.id as string };
}

async function slots(): Promise<string[]> {
  const res = await request(app).get(`/${slug}/availability`).query({ serviceId: service, from: DAY });
  return (res.body.days[0].slots as { startsAt: string }[]).map((s) => s.startsAt);
}

beforeAll(async () => {
  owner = await signUp('owner');
  await request(app).post('/me/tenants').set('Cookie', owner.cookie).send({ name: 'History', slug, timezone: 'UTC' }).expect(201);
  ({ id: tenantId, better_auth_org_id: orgId } = (await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug])).rows[0]);
  ana = (await request(app).post(`/tenant/${slug}/staff`).set('Cookie', owner.cookie).send({ name: 'Ana' })).body.id;
  service = (await ownerPool.query(`INSERT INTO service (tenant_id, name, duration_minutes) VALUES ($1, 'Cut', 30) RETURNING id`, [tenantId])).rows[0].id;
  await ownerPool.query('INSERT INTO staff_service (staff_id, service_id, tenant_id) VALUES ($1, $2, $3)', [ana, service, tenantId]);
  await ownerPool.query(`INSERT INTO business_hours (tenant_id, weekday, opens_at, closes_at) VALUES ($1, 1, '09:00', '17:00')`, [tenantId]);
  await ownerPool.query(`INSERT INTO staff_working_hours (staff_id, tenant_id, weekday, start_time, end_time) VALUES ($1, $2, 1, '09:00', '17:00')`, [ana, tenantId]);
});

afterAll(async () => {
  for (const table of ['appointment', 'customer', 'staff_service', 'staff_working_hours', 'business_hours', 'service', 'staff']) {
    await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await ownerPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM organization WHERE id = $1', [orgId]);
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
});

describe('appointment history', () => {
  let appointmentId = '';

  it('records a booking, a move and a cancellation, and who did each', async () => {
    const [first, , third] = await slots();
    const booked = await request(app)
      .post(`/${slug}/appointments`)
      .send({ serviceId: service, staffId: ana, startsAt: first, customer: { name: 'Cleo', email: `cleo-${run}@customer.example` } });
    expect(booked.status, JSON.stringify(booked.body)).toBe(201);
    appointmentId = booked.body.appointmentId;

    const moved = await request(app)
      .post(`/tenant/${slug}/appointments/${appointmentId}/reschedule`)
      .set('Cookie', owner.cookie)
      .send({ startsAt: third });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);

    expect((await request(app).post(`/${slug}/appointments/cancel`).send({ token: booked.body.manageToken })).status).toBe(200);

    const res = await request(app).get(`/tenant/${slug}/appointments/${appointmentId}/history`).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    const events = res.body.events as { kind: string; actor: { kind: string; name?: string }; [k: string]: unknown }[];
    expect(events.map((e) => e.kind)).toEqual(['booked', 'moved', 'status']);
    expect(events[0]).toMatchObject({ actor: { kind: 'customer' }, staffName: 'Ana', startsAt: new Date(first!).toISOString() });
    expect(events[1]).toMatchObject({
      actor: { kind: 'member', name: 'Hanna Owner' },
      previousStartsAt: new Date(first!).toISOString(),
      startsAt: new Date(third!).toISOString(),
    });
    expect(events[2]).toMatchObject({ actor: { kind: 'customer' }, previousStatus: 'BOOKED', status: 'CANCELLED' });
  });

  it("can't be written or rewritten by the app's database role", async () => {
    const codes = await withContext(appPool, { tenantId, userId: owner.userId }, async (c) => {
      const tryIt = (sql: string) => c.query('SAVEPOINT s').then(() =>
        c.query(sql).then(
          () => 'ok',
          async (e: { code?: string }) => {
            await c.query('ROLLBACK TO SAVEPOINT s');
            return e.code;
          },
        ),
      );
      return [
        await tryIt(`UPDATE appointment_event SET kind = 'booked' WHERE appointment_id = '${appointmentId}'`),
        await tryIt(`DELETE FROM appointment_event WHERE appointment_id = '${appointmentId}'`),
        await tryIt(`INSERT INTO appointment_event (tenant_id, appointment_id, kind) VALUES ('${tenantId}', '${appointmentId}', 'booked')`),
      ];
    });
    expect(codes).toEqual(['42501', '42501', '42501']);
  });

  it("is a 404 for another organization's appointment, and for staff a 403", async () => {
    const elsewhere = (await ownerPool.query(`SELECT id FROM appointment WHERE tenant_id <> $1 LIMIT 1`, [tenantId])).rows[0]?.id ?? randomUUID();
    expect((await request(app).get(`/tenant/${slug}/appointments/${elsewhere}/history`).set('Cookie', owner.cookie)).status).toBe(404);

    const stranger = await signUp('staffer');
    await ownerPool.query(`INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, 'member', now())`, [
      randomUUID(),
      orgId,
      stranger.userId,
    ]);
    expect((await request(app).get(`/tenant/${slug}/appointments/${appointmentId}/history`).set('Cookie', stranger.cookie)).status).toBe(403);
  });
});
