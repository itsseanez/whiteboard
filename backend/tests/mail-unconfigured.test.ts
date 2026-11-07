import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

// Own file, so the mailer is built fresh with a config that can't send.
process.env.MAIL_TRANSPORT = 'unset';
const { createApp } = await import('../src/app.js');
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);
const slug = `nomail-${run}`;
const email = `nomail-${run}@test.example`;

afterAll(async () => {
  const { rows } = await ownerPool.query('SELECT id, better_auth_org_id AS org FROM tenant WHERE slug = $1', [slug]);
  if (rows[0]) {
    await ownerPool.query('DELETE FROM staff WHERE tenant_id = $1', [rows[0].id]);
    await ownerPool.query('DELETE FROM tenant WHERE id = $1', [rows[0].id]);
    await ownerPool.query('DELETE FROM invitation WHERE "organizationId" = $1', [rows[0].org]);
    await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [rows[0].org]);
    await ownerPool.query('DELETE FROM organization WHERE id = $1', [rows[0].org]);
  }
  await ownerPool.query(`DELETE FROM job WHERE payload->>'to' LIKE $1`, [`%nomail-${run}%`]);
  await ownerPool.query('DELETE FROM "user" WHERE email = $1', [email]);
  await ownerPool.end();
});

/** The unfinished outbox rows addressed to someone. */
async function waiting(to: string) {
  const { rows } = await ownerPool.query<{ attempts: number }>(
    `SELECT attempts FROM job WHERE finished_at IS NULL AND payload->>'to' = $1`,
    [to],
  );
  return rows;
}

describe('without email configured', () => {
  it('still invites, and the email waits in the outbox without spending attempts', async () => {
    const signUp = await request(app).post('/api/auth/sign-up/email').send({ name: 'O', email, password: 'test-password-123' });
    const cookie = (signUp.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
    await request(app).post('/me/tenants').set('Cookie', cookie).send({ name: 'No Mail', slug, timezone: 'UTC' });
    const staff = await request(app).post(`/tenant/${slug}/staff`).set('Cookie', cookie).send({ name: 'Ana' });
    const res = await request(app)
      .post(`/tenant/${slug}/invitations`)
      .set('Cookie', cookie)
      .send({ email: `ana-${run}@test.example`, role: 'staff', staffId: staff.body.id });
    expect(res.status).toBe(201);
    expect(await waiting(`ana-${run}@test.example`)).toEqual([{ attempts: 0 }]);
    await ownerPool.query(`DELETE FROM job WHERE payload->>'to' = $1`, [`ana-${run}@test.example`]);
  });

  it('still books, with the confirmation queued for when email works', async () => {
    // Marina on a Friday: no other test books her that day.
    let date = Temporal.Now.plainDateISO('America/New_York').add({ days: 2 });
    while (date.dayOfWeek !== 5) date = date.add({ days: 1 });
    const cut = 'b1111111-1111-1111-1111-111111111111';
    const avail = await request(app).get('/marinas-cuts-color/availability').query({ serviceId: cut, from: date.toString() });
    const slot = avail.body.days[0].slots[0];
    const customer = `nomail-${run}@customer.example`;
    try {
      const res = await request(app)
        .post('/marinas-cuts-color/appointments')
        .send({ serviceId: cut, staffId: slot.staffIds[0], startsAt: slot.startsAt, customer: { name: 'No Mail', email: customer } });
      expect(res.status).toBe(201);
      expect(res.body.emailed).toBe(true);
      expect(res.body.manageToken).toBeTruthy();
      expect(await waiting(customer)).toHaveLength(1);
    } finally {
      await ownerPool.query(`DELETE FROM job WHERE payload->>'to' = $1`, [customer]);
      await ownerPool.query(
        `WITH mine AS (SELECT id FROM customer WHERE email = $1),
              cleared AS (DELETE FROM appointment WHERE customer_id IN (SELECT id FROM mine))
         DELETE FROM customer WHERE id IN (SELECT id FROM mine)`,
        [customer],
      );
    }
  });
});
