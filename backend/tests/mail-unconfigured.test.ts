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
  await ownerPool.query('DELETE FROM "user" WHERE email = $1', [email]);
  await ownerPool.end();
});

describe('inviting without email configured', () => {
  it('answers 503 email_unavailable rather than a 500', async () => {
    const signUp = await request(app).post('/api/auth/sign-up/email').send({ name: 'O', email, password: 'test-password-123' });
    const cookie = (signUp.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
    await request(app).post('/me/tenants').set('Cookie', cookie).send({ name: 'No Mail', slug, timezone: 'UTC' });
    const staff = await request(app).post(`/tenant/${slug}/staff`).set('Cookie', cookie).send({ name: 'Ana' });
    const res = await request(app)
      .post(`/tenant/${slug}/invitations`)
      .set('Cookie', cookie)
      .send({ email: `ana-${run}@test.example`, role: 'staff', staffId: staff.body.id });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('email_unavailable');
  });
});
