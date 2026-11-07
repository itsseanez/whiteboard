import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';

// Changing your own password and email, through Better Auth's routes. Both
// need the current password: change-password always has, and change-email
// does through our hook, because with no verification it applies at once.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);
const PASSWORD = 'test-password-123';
const userIds: string[] = [];

const address = (label: string) => `${label}-${run}@test.example`;

function cookieOf(res: request.Response): string {
  return (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
}

async function signUp(label: string) {
  const res = await request(app).post('/api/auth/sign-up/email').send({ name: label, email: address(label), password: PASSWORD });
  userIds.push(res.body.user.id);
  return { cookie: cookieOf(res), userId: res.body.user.id as string };
}

const signIn = (email: string, password: string) =>
  request(app).post('/api/auth/sign-in/email').send({ email, password });

const emailOf = async (id: string) =>
  (await ownerPool.query<{ email: string }>('SELECT email FROM "user" WHERE id = $1', [id])).rows[0]?.email;

afterAll(async () => {
  await ownerPool.query('DELETE FROM "user" WHERE id = ANY($1)', [userIds]);
  await ownerPool.end();
});

describe('change password', () => {
  it('needs the current password, then signs out everywhere else', async () => {
    const me = await signUp('pw');
    const elsewhere = cookieOf(await signIn(address('pw'), PASSWORD));

    const wrong = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', me.cookie)
      .send({ currentPassword: 'not-it-at-all', newPassword: 'brand-new-pass-1', revokeOtherSessions: true });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('INVALID_PASSWORD');

    const changed = await request(app)
      .post('/api/auth/change-password')
      .set('Cookie', me.cookie)
      .send({ currentPassword: PASSWORD, newPassword: 'brand-new-pass-1', revokeOtherSessions: true });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);

    expect((await signIn(address('pw'), PASSWORD)).status).toBe(401);
    expect((await signIn(address('pw'), 'brand-new-pass-1')).status).toBe(200);
    const other = await request(app).get('/api/auth/get-session').set('Cookie', elsewhere);
    expect(other.body).toBeNull();
  });
});

describe('change email', () => {
  const change = (cookie: string, body: object) => request(app).post('/api/auth/change-email').set('Cookie', cookie).send(body);

  it('refuses without the password, or with the wrong one, and changes nothing', async () => {
    const me = await signUp('em1');
    const none = await change(me.cookie, { newEmail: address('em1-new') });
    expect(none.status).toBe(400);
    expect(none.body.code).toBe('PASSWORD_REQUIRED');

    const wrong = await change(me.cookie, { newEmail: address('em1-new'), password: 'not-it-at-all' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('INVALID_PASSWORD');
    expect(await emailOf(me.userId)).toBe(address('em1'));
  });

  it('applies at once with the password, and the new address signs in', async () => {
    const me = await signUp('em2');
    const res = await change(me.cookie, { newEmail: address('em2-new'), password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await emailOf(me.userId)).toBe(address('em2-new'));
    expect((await signIn(address('em2-new'), PASSWORD)).status).toBe(200);
    expect((await signIn(address('em2'), PASSWORD)).status).toBe(401);
  });

  it("answers the same for an address someone else has, but doesn't take it", async () => {
    const me = await signUp('em3');
    await signUp('em3-taken');
    const res = await change(me.cookie, { newEmail: address('em3-taken'), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(await emailOf(me.userId)).toBe(address('em3'));
  });

  it('needs a session', async () => {
    const res = await request(app).post('/api/auth/change-email').send({ newEmail: address('nobody'), password: PASSWORD });
    expect(res.status).toBe(401);
  });
});
