import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { outbox } from '../src/lib/mailer.js';

// Forgotten passwords and email checks, through Better Auth's routes and the
// memory mailer. Verification is sent but never required.
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
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  userIds.push(res.body.user.id);
  return { cookie: cookieOf(res), userId: res.body.user.id as string };
}

/** The newest email to this address, and the link in it. */
function mailTo(to: string) {
  const mail = [...outbox].reverse().find((m) => m.to === to);
  if (!mail) throw new Error(`No email to ${to}`);
  const link = new URL(mail.text.match(/https?:\/\/\S+/)![0]);
  return { mail, link, token: link.searchParams.get('token')! };
}

const user = async (id: string) =>
  (await ownerPool.query<{ email: string; emailVerified: boolean }>('SELECT email, "emailVerified" FROM "user" WHERE id = $1', [id]))
    .rows[0]!;

afterAll(async () => {
  await ownerPool.query('DELETE FROM "user" WHERE id = ANY($1)', [userIds]);
  await ownerPool.end();
});

describe('email verification', () => {
  it('is sent at sign-up, not required to sign in, and the link verifies', async () => {
    const me = await signUp('verify');
    const { mail, link } = mailTo(address('verify'));
    expect(mail.subject).toMatch(/Confirm your email/);
    expect(link.pathname).toBe('/api/auth/verify-email');
    expect((await user(me.userId)).emailVerified).toBe(false);

    const signedIn = await request(app).post('/api/auth/sign-in/email').send({ email: address('verify'), password: PASSWORD });
    expect(signedIn.status).toBe(200);

    const followed = await request(app).get(`${link.pathname}${link.search}`);
    expect(followed.status).toBe(302);
    expect(followed.headers.location).toMatch(/\/account\?verified=1$/);
    expect((await user(me.userId)).emailVerified).toBe(true);
  });

  it('can be sent again on request', async () => {
    await signUp('again');
    const before = outbox.filter((m) => m.to === address('again')).length;
    const res = await request(app).post('/api/auth/send-verification-email').send({ email: address('again') });
    expect(res.status).toBe(200);
    expect(outbox.filter((m) => m.to === address('again')).length).toBe(before + 1);
  });
});

describe('forgot password', () => {
  it('emails a one-time link that sets a new password and signs out everywhere', async () => {
    const me = await signUp('reset');
    const res = await request(app).post('/api/auth/request-password-reset').send({ email: address('reset') });
    expect(res.status).toBe(200);
    const { link, token } = mailTo(address('reset'));
    expect(link.pathname).toBe('/signin/reset');

    const reset = await request(app).post('/api/auth/reset-password').send({ newPassword: 'a-fresh-password-1', token });
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);

    expect((await request(app).post('/api/auth/sign-in/email').send({ email: address('reset'), password: PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/auth/sign-in/email').send({ email: address('reset'), password: 'a-fresh-password-1' })).status).toBe(200);
    expect((await request(app).get('/api/auth/get-session').set('Cookie', me.cookie)).body).toBeNull();

    const again = await request(app).post('/api/auth/reset-password').send({ newPassword: 'another-password-2', token });
    expect(again.status).toBe(400);
  });

  it('answers the same for an address with no account, and sends nothing', async () => {
    const known = await request(app).post('/api/auth/request-password-reset').send({ email: address('reset') });
    const before = outbox.length;
    const unknown = await request(app).post('/api/auth/request-password-reset').send({ email: address('nobody') });
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    expect(outbox.length).toBe(before);
  });
});

describe('changing a verified email', () => {
  it('waits for the link sent to the new address', async () => {
    const me = await signUp('moving');
    const verify = mailTo(address('moving')).link;
    await request(app).get(`${verify.pathname}${verify.search}`);
    // Verifying signed nobody in again, so the old cookie still works.

    const res = await request(app)
      .post('/api/auth/change-email')
      .set('Cookie', me.cookie)
      .send({ newEmail: address('moved'), password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await user(me.userId)).email).toBe(address('moving'));

    const { link } = mailTo(address('moved'));
    await request(app).get(`${link.pathname}${link.search}`);
    expect((await user(me.userId)).email).toBe(address('moved'));
  });
});
