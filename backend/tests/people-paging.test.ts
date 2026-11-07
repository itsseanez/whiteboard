import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { outbox } from '../src/lib/mailer.js';

// Past Better Auth's default of 100 members, which refuses the 101st
// invitation, and past the old listing cap of 500.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);
const slug = `many-${run}`;

afterAll(async () => {
  const { rows } = await ownerPool.query('SELECT id, better_auth_org_id AS org FROM tenant WHERE slug = $1', [slug]);
  await ownerPool.query('DELETE FROM invitation WHERE "organizationId" = $1', [rows[0]?.org]);
  await ownerPool.query('DELETE FROM tenant WHERE slug = $1', [slug]);
  await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [rows[0]?.org]);
  await ownerPool.query('DELETE FROM organization WHERE id = $1', [rows[0]?.org]);
  await ownerPool.query(`DELETE FROM "user" WHERE email LIKE $1`, [`%-${run}@test.example`]);
  await ownerPool.end();
});

describe('the people list', () => {
  it('lists every member of a large organization, and lets one more join', async () => {
    const signUp = await request(app).post('/api/auth/sign-up/email').send({ name: 'Owner', email: `owner-${run}@test.example`, password: 'test-password-123' });
    const cookie = (signUp.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
    await request(app).post('/me/tenants').set('Cookie', cookie).send({ name: 'Many', slug, timezone: 'UTC' }).expect(201);
    const org = (await ownerPool.query('SELECT better_auth_org_id AS org FROM tenant WHERE slug = $1', [slug])).rows[0].org;
    await ownerPool.query(
      `WITH people AS (
         INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         SELECT gen_random_uuid()::text, 'Staff ' || n, 'staff' || n || '-' || $2 || '@test.example', false, now(), now()
         FROM generate_series(1, 505) n RETURNING id)
       INSERT INTO member (id, "organizationId", "userId", role, "createdAt")
       SELECT gen_random_uuid()::text, $1, id, 'member', now() FROM people`,
      [org, run],
    );
    const res = await request(app).get(`/tenant/${slug}/people`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(506);
    expect(new Set(res.body.members.map((m: { memberId: string }) => m.memberId)).size).toBe(506);

    // And someone new can still join.
    const staff = await request(app).post(`/tenant/${slug}/staff`).set('Cookie', cookie).send({ name: 'Newcomer' });
    const email = `newcomer-${run}@test.example`;
    expect((await request(app).post(`/tenant/${slug}/invitations`).set('Cookie', cookie).send({ email, role: 'staff', staffId: staff.body.id })).status).toBe(201);
    const joined = await request(app).post('/api/auth/sign-up/email').send({ name: 'Newcomer', email, password: 'test-password-123' });
    const theirs = (joined.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
    const id = [...outbox].reverse().find((m) => m.to === email && m.text.includes('/invite/'))?.text.match(/\/invite\/([^?\s]+)/)?.[1];
    const accepted = await request(app).post(`/me/invitations/${id}/accept`).set('Cookie', theirs);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    await ownerPool.query('DELETE FROM staff WHERE id = $1', [staff.body.id]);
  });
});
