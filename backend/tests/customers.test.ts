import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

// Erasing a customer's details: owners only, refused while they have an
// upcoming booking, and their past appointments stay.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);
const slug = `erase-${run}`;
const emails: string[] = [];

let owner = '';
let manager = '';
let tenantId = '';
let orgId = '';
let ana = '';
let service = '';

async function signUp(label: string, role?: 'admin') {
  const email = `${label}-${run}@test.example`;
  emails.push(email);
  const res = await request(app).post('/api/auth/sign-up/email').send({ name: label, email, password: 'test-password-123' });
  if (role) {
    await ownerPool.query(`INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, $4, now())`, [randomUUID(), orgId, res.body.user.id, role]);
  }
  return (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
}

async function customerWith(when: Date): Promise<{ customer: string; appointment: string }> {
  const customer = (await ownerPool.query(`INSERT INTO customer (tenant_id, name, email, phone) VALUES ($1, 'Jo Bloggs', $2, '555-0100') RETURNING id`, [tenantId, `jo-${randomUUID().slice(0, 6)}@customer.example`])).rows[0].id;
  const ends = new Date(when.getTime() + 30 * 60_000);
  const appointment = (await ownerPool.query(
    `INSERT INTO appointment (tenant_id, staff_id, service_id, customer_id, starts_at, ends_at, blocked_starts_at, blocked_ends_at, manage_token_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7) RETURNING id`,
    [tenantId, ana, service, customer, when, ends, randomBytes(32).toString('hex')],
  )).rows[0].id;
  return { customer, appointment };
}

const erase = (id: string, cookie: string) => request(app).post(`/tenant/${slug}/customers/${id}/erase`).set('Cookie', cookie);

beforeAll(async () => {
  owner = await signUp('owner');
  await request(app).post('/me/tenants').set('Cookie', owner).send({ name: 'Erase', slug, timezone: 'UTC' }).expect(201);
  ({ id: tenantId, better_auth_org_id: orgId } = (await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug])).rows[0]);
  manager = await signUp('manager', 'admin');
  ana = (await request(app).post(`/tenant/${slug}/staff`).set('Cookie', owner).send({ name: 'Ana' })).body.id;
  service = (await ownerPool.query(`INSERT INTO service (tenant_id, name, duration_minutes) VALUES ($1, 'Cut', 30) RETURNING id`, [tenantId])).rows[0].id;
});

afterAll(async () => {
  for (const table of ['appointment', 'customer', 'service', 'staff']) await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  await ownerPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM organization WHERE id = $1', [orgId]);
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
});

describe('erasing a customer', () => {
  it('replaces their details and keeps their past appointments', async () => {
    const { customer, appointment } = await customerWith(new Date(Date.now() - 7 * 86_400_000));
    expect((await erase(customer, manager)).status).toBe(403);
    expect((await erase(customer, owner)).status).toBe(204);

    const row = (await ownerPool.query('SELECT name, email, phone FROM customer WHERE id = $1', [customer])).rows[0];
    expect(row).toEqual({ name: 'Erased customer', email: `erased-${customer}@invalid`, phone: null });
    expect((await ownerPool.query('SELECT 1 FROM appointment WHERE id = $1', [appointment])).rowCount).toBe(1);
  });

  it('is refused while they have an upcoming booking', async () => {
    const { customer } = await customerWith(new Date(Date.now() + 7 * 86_400_000));
    const res = await erase(customer, owner);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'has_future_appointments' });
  });

  it("is a 404 for another organization's customer", async () => {
    const elsewhere = (await ownerPool.query('SELECT id FROM customer WHERE tenant_id <> $1 LIMIT 1', [tenantId])).rows[0]?.id ?? randomUUID();
    expect((await erase(elsewhere, owner)).status).toBe(404);
  });
});
