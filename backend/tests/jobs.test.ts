import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { getMailer, outbox } from '../src/lib/mailer.js';
import { queueDueReminders, runDueJobs } from '../src/jobs/queue.js';

// The outbox and what feeds it: retries, expiry, exactly-one claim under
// concurrency, the appointment trigger's staff notices, and reminders.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);
const slug = `jobs-${run}`;
const emails: string[] = [];

let owner = { cookie: '', userId: '' };
let tenantId = '';
let orgId = '';
let ana = '';
let service = '';
let customer = '';
const anaEmail = `ana-${run}@test.example`;

function cookieOf(res: request.Response): string {
  return (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
}

async function signUp(email: string, name: string) {
  emails.push(email);
  const res = await request(app).post('/api/auth/sign-up/email').send({ name, email, password: 'test-password-123' });
  return { cookie: cookieOf(res), userId: res.body.user.id as string };
}

async function job(payload: object, extra: { expires?: string; kind?: string } = {}): Promise<string> {
  const { rows } = await ownerPool.query<{ id: string }>(
    `INSERT INTO job (kind, payload, expires_at) VALUES ($1, $2, now() + $3::interval) RETURNING id`,
    [extra.kind ?? 'mail', payload, extra.expires ?? '1 hour'],
  );
  return rows[0]!.id;
}

const row = async (id: string) =>
  (await ownerPool.query('SELECT attempts, outcome, finished_at, payload, last_error, run_at > now() AS later FROM job WHERE id = $1', [id])).rows[0];

const sentTo = (to: string) => outbox.filter((m) => m.to === to);

async function appointment(startsAt: Date, createdAt: Date): Promise<string> {
  const ends = new Date(startsAt.getTime() + 30 * 60_000);
  const { rows } = await ownerPool.query<{ id: string }>(
    `INSERT INTO appointment (tenant_id, staff_id, service_id, customer_id, starts_at, ends_at, blocked_starts_at, blocked_ends_at, manage_token_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7, $8) RETURNING id`,
    [tenantId, ana, service, customer, startsAt, ends, randomBytes(32).toString('hex'), createdAt],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  owner = await signUp(`owner-${run}@test.example`, 'Olga');
  await request(app).post('/me/tenants').set('Cookie', owner.cookie).send({ name: 'Jobs', slug, timezone: 'UTC' }).expect(201);
  ({ id: tenantId, better_auth_org_id: orgId } = (await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug])).rows[0]);
  ana = (await request(app).post(`/tenant/${slug}/staff`).set('Cookie', owner.cookie).send({ name: 'Ana' })).body.id;
  const anaLogin = await signUp(anaEmail, 'Ana');
  await ownerPool.query('UPDATE staff SET user_id = $1 WHERE id = $2', [anaLogin.userId, ana]);
  await ownerPool.query(`INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, 'member', now())`, [randomUUID(), orgId, anaLogin.userId]);
  service = (await ownerPool.query(`INSERT INTO service (tenant_id, name, duration_minutes) VALUES ($1, 'Cut', 30) RETURNING id`, [tenantId])).rows[0].id;
  customer = (await ownerPool.query(`INSERT INTO customer (tenant_id, name, email) VALUES ($1, 'Cleo', $2) RETURNING id`, [tenantId, `cleo-${run}@customer.example`])).rows[0].id;
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await ownerPool.query(`DELETE FROM job WHERE payload->>'to' LIKE $1 OR payload = '{}'::jsonb`, [`%${run}%`]);
  for (const table of ['appointment', 'customer', 'service', 'staff']) {
    await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await ownerPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM organization WHERE id = $1', [orgId]);
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
});

describe('the outbox', () => {
  // Other files leave jobs behind (staff notices from their bookings); clear
  // them so a mocked failure lands on this file's job.
  beforeAll(async () => {
    while ((await runDueJobs()) > 0) {
      // drain
    }
  });

  it('retries a failed send later, then clears the payload once it goes', async () => {
    const to = `retry-${run}@test.example`;
    const id = await job({ to, subject: 'Hello', text: 'Body' });
    vi.spyOn(getMailer(), 'send').mockRejectedValueOnce(new Error('SES is down'));
    await runDueJobs();
    expect(await row(id)).toMatchObject({ attempts: 1, outcome: null, last_error: 'SES is down', later: true });

    await ownerPool.query('UPDATE job SET run_at = now() WHERE id = $1', [id]);
    await runDueJobs();
    expect(await row(id)).toMatchObject({ attempts: 2, outcome: 'sent', payload: {} });
    expect(sentTo(to)).toHaveLength(1);
  });

  it('drops a job past its useful life without sending it', async () => {
    const to = `late-${run}@test.example`;
    const id = await job({ to, subject: 'Too late', text: 'Body' }, { expires: '-1 minute' });
    await runDueJobs();
    expect(await row(id)).toMatchObject({ outcome: 'expired', payload: {}, attempts: 0 });
    expect(sentTo(to)).toHaveLength(0);
  });

  it("skips a job another worker is claiming, instead of waiting and sending it too", async () => {
    const to = `once-${run}@test.example`;
    const id = await job({ to, subject: 'Once', text: 'Body' });
    // Another worker, mid-claim: it has taken the row and not committed yet.
    const other = await ownerPool.connect();
    try {
      await other.query('BEGIN');
      await other.query(`UPDATE job SET locked_until = now() + interval '5 minutes', attempts = attempts + 1 WHERE id = $1`, [id]);
      let settled = false;
      const ours = runDueJobs().finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      const waited = !settled;
      await other.query('COMMIT');
      await ours;
      expect(waited).toBe(false); // SKIP LOCKED: no waiting on someone else's row
      expect(sentTo(to)).toHaveLength(0); // and no second send once they commit
    } finally {
      other.release();
    }
  });
});

describe('staff notices', () => {
  it("tell the staff member when a customer books, and not when they move it themselves", async () => {
    const before = sentTo(anaEmail).length;
    const id = await appointment(new Date(Date.now() + 3 * 86_400_000), new Date());
    await runDueJobs();
    const notices = sentTo(anaEmail).slice(before);
    expect(notices).toHaveLength(1);
    expect(notices[0]!.subject).toMatch(/^New booking: Cut/);
    expect(notices[0]!.text).toMatch(/Cleo booked Cut with you/);

    // Ana herself moves it: no notice to Ana.
    const anaUser = (await ownerPool.query('SELECT user_id FROM staff WHERE id = $1', [ana])).rows[0].user_id;
    const client = await ownerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [anaUser]);
      await client.query(`UPDATE appointment SET starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour',
                            blocked_starts_at = blocked_starts_at + interval '1 hour', blocked_ends_at = blocked_ends_at + interval '1 hour' WHERE id = $1`, [id]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await runDueJobs();
    expect(sentTo(anaEmail).slice(before)).toHaveLength(1);

    // The owner cancels it: Ana hears.
    await ownerPool.query(`UPDATE appointment SET status = 'CANCELLED' WHERE id = $1`, [id]);
    await runDueJobs();
    expect(sentTo(anaEmail).slice(before).map((m) => m.subject)).toEqual([expect.stringMatching(/^New booking/), expect.stringMatching(/^Cancelled/)]);
  });
});

describe('reminders', () => {
  const cleo = `cleo-${run}@customer.example`;
  const reminders = () => sentTo(cleo).filter((m) => m.subject.startsWith('Reminder'));

  it('go out once for tomorrow, are withdrawn when it moves, and come again for the new time', async () => {
    const id = await appointment(new Date(Date.now() + 20 * 3_600_000), new Date(Date.now() - 3 * 86_400_000));
    expect(await queueDueReminders()).toBeGreaterThanOrEqual(1);
    expect(await queueDueReminders()).toBe(0); // deduplicated

    await ownerPool.query(`UPDATE appointment SET starts_at = starts_at + interval '2 hours', ends_at = ends_at + interval '2 hours',
                             blocked_starts_at = blocked_starts_at + interval '2 hours', blocked_ends_at = blocked_ends_at + interval '2 hours' WHERE id = $1`, [id]);
    const withdrawn = await ownerPool.query(`SELECT outcome FROM job WHERE dedupe_key LIKE $1`, [`reminder:${id}:%`]);
    expect(withdrawn.rows.map((r) => r.outcome)).toEqual(['cancelled']);

    expect(await queueDueReminders()).toBe(1);
    await runDueJobs();
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0]!.text).toMatch(/use the link in your confirmation email/);
  });

  it("skip appointments booked less than a day ahead", async () => {
    const id = await appointment(new Date(Date.now() + 10 * 3_600_000), new Date());
    await queueDueReminders();
    expect((await ownerPool.query(`SELECT 1 FROM job WHERE dedupe_key LIKE $1`, [`reminder:${id}:%`])).rowCount).toBe(0);
  });
});
