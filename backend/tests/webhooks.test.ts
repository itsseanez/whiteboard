import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { runDueJobs } from '../src/jobs/queue.js';
import { BlockedAddressError, guardedLookup, isBlockedAddress, sign, webhookUrlProblem } from '../src/jobs/webhook.js';

// Webhooks: the address guard, then delivery to a receiver on this machine,
// which the guard allows only because WEBHOOK_ALLOW_PRIVATE is set around it.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const run = randomUUID().slice(0, 8);
const slug = `hooks-${run}`;
const emails: string[] = [];

let owner = { cookie: '', userId: '' };
let manager = { cookie: '', userId: '' };
let tenantId = '';
let orgId = '';
let ana = '';
let service = '';
let customer = '';

interface Received {
  headers: http.IncomingHttpHeaders;
  body: string;
}
const received: Received[] = [];
let answer = 200;
let receiver: http.Server;
let hookUrl = '';

function cookieOf(res: request.Response): string {
  return (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('better-auth.session_token='))!;
}

async function signUp(label: string) {
  const email = `${label}-${run}@test.example`;
  emails.push(email);
  const res = await request(app).post('/api/auth/sign-up/email').send({ name: label, email, password: 'test-password-123' });
  return { cookie: cookieOf(res), userId: res.body.user.id as string };
}

const api = {
  get: (path: string, c: string) => request(app).get(`/tenant/${slug}${path}`).set('Cookie', c),
  post: (path: string, body: object, c: string) => request(app).post(`/tenant/${slug}${path}`).set('Cookie', c).send(body),
  delete: (path: string, c: string) => request(app).delete(`/tenant/${slug}${path}`).set('Cookie', c),
};

async function book(): Promise<string> {
  const starts = new Date(Date.now() + 5 * 86_400_000);
  const ends = new Date(starts.getTime() + 30 * 60_000);
  const { rows } = await ownerPool.query<{ id: string }>(
    `INSERT INTO appointment (tenant_id, staff_id, service_id, customer_id, starts_at, ends_at, blocked_starts_at, blocked_ends_at, manage_token_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7) RETURNING id`,
    [tenantId, ana, service, customer, starts, ends, randomBytes(32).toString('hex')],
  );
  return rows[0]!.id;
}

async function drain() {
  while ((await runDueJobs()) > 0) {
    // until nothing is due
  }
}

beforeAll(async () => {
  receiver = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = answer;
      res.end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  hookUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  owner = await signUp('owner');
  await request(app).post('/me/tenants').set('Cookie', owner.cookie).send({ name: 'Hooks', slug, timezone: 'UTC' }).expect(201);
  ({ id: tenantId, better_auth_org_id: orgId } = (await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug])).rows[0]);
  manager = await signUp('manager');
  await ownerPool.query(`INSERT INTO member (id, "organizationId", "userId", role, "createdAt") VALUES ($1, $2, $3, 'admin', now())`, [randomUUID(), orgId, manager.userId]);
  ana = (await api.post('/staff', { name: 'Ana' }, owner.cookie)).body.id;
  service = (await ownerPool.query(`INSERT INTO service (tenant_id, name, duration_minutes) VALUES ($1, 'Cut', 30) RETURNING id`, [tenantId])).rows[0].id;
  customer = (await ownerPool.query(`INSERT INTO customer (tenant_id, name, email) VALUES ($1, 'Cleo', $2) RETURNING id`, [tenantId, `cleo-${run}@customer.example`])).rows[0].id;
  await drain(); // whatever other files left behind
});

afterEach(() => {
  delete process.env.WEBHOOK_ALLOW_PRIVATE;
});

afterAll(async () => {
  await ownerPool.query(`DELETE FROM job WHERE ref IN (SELECT id FROM webhook_endpoint WHERE tenant_id = $1)`, [tenantId]);
  await ownerPool.query('DELETE FROM webhook_endpoint WHERE tenant_id = $1', [tenantId]);
  for (const table of ['appointment', 'customer', 'service', 'staff']) {
    await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await ownerPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM organization WHERE id = $1', [orgId]);
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
  await new Promise((resolve) => receiver.close(resolve));
});

describe('the address guard', () => {
  it('blocks private, loopback, link-local and metadata addresses, in both families', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::ffff:127.0.0.1', '::ffff:169.254.169.254', 'fd00::1', 'fe80::1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it('refuses metadata and localhost URLs at registration', () => {
    expect(webhookUrlProblem('http://169.254.169.254/latest/meta-data/')).toBe('url must be a public address');
    expect(webhookUrlProblem('http://[::1]:3000/')).toBe('url must be a public address');
    expect(webhookUrlProblem('http://localhost:3000/')).toBe('url must be a public address');
    expect(webhookUrlProblem('https://user:pass@example.com/')).toMatch(/username or password/);
    expect(webhookUrlProblem('ftp://example.com/')).toBe('url must use https');
    expect(webhookUrlProblem('https://hooks.example.com/whiteboard')).toBeNull();
  });

  it('refuses a hostname at connection time when it resolves to a private address', async () => {
    const error = await new Promise<Error | null>((resolve) => guardedLookup('localhost', {}, (err) => resolve(err)));
    expect(error).toBeInstanceOf(BlockedAddressError);
  });
});

describe('webhooks', () => {
  let secret = '';
  let endpointId = '';

  it('are for owners only', async () => {
    expect((await api.get('/webhooks', manager.cookie)).status).toBe(403);
    expect((await api.post('/webhooks', { url: 'https://hooks.example.com/x' }, manager.cookie)).status).toBe(403);
  });

  it('refuse a private address when registering', async () => {
    const res = await api.post('/webhooks', { url: hookUrl }, owner.cookie);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('url must be a public address');
  });

  it('POST every appointment change, signed, with an event id', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = '1';
    const created = await api.post('/webhooks', { url: hookUrl }, owner.cookie);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    ({ id: endpointId, secret } = created.body);
    expect(secret).toMatch(/^whsec_/);
    expect((await api.get('/webhooks', owner.cookie)).body.webhooks[0]).not.toHaveProperty('secret');

    const appointmentId = await book();
    await ownerPool.query(`UPDATE appointment SET status = 'CANCELLED' WHERE id = $1`, [appointmentId]);
    received.length = 0;
    await drain();

    const types = received.map((r) => JSON.parse(r.body).type);
    expect(types).toEqual(['appointment.booked', 'appointment.cancelled']);
    const first = received[0]!;
    const event = JSON.parse(first.body);
    expect(event.data).toMatchObject({ appointmentId, service: { name: 'Cut' }, staff: { name: 'Ana' }, customer: { name: 'Cleo' } });
    expect(first.headers['whiteboard-event-id']).toBe(event.id);
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(String(first.headers['whiteboard-signature']))!;
    expect(v1).toBe(sign(secret, Number(t), first.body));
  });

  it('retry when the receiver fails, and record it', async () => {
    process.env.WEBHOOK_ALLOW_PRIVATE = '1';
    answer = 500;
    expect((await api.post(`/webhooks/${endpointId}/test`, {}, owner.cookie)).status).toBe(202);
    await drain();
    let deliveries = (await api.get('/webhooks', owner.cookie)).body.webhooks[0].deliveries;
    expect(deliveries[0]).toMatchObject({ label: 'ping', outcome: null, attempts: 1, lastError: 'answered 500' });

    answer = 200;
    await ownerPool.query(`UPDATE job SET run_at = now() WHERE ref = $1 AND finished_at IS NULL`, [endpointId]);
    await drain();
    deliveries = (await api.get('/webhooks', owner.cookie)).body.webhooks[0].deliveries;
    expect(deliveries[0]).toMatchObject({ label: 'ping', outcome: 'sent', attempts: 2 });
  });

  it("refuse delivery to a private address once the exemption is gone", async () => {
    // Registered while allowed; delivered without it, as production would.
    await api.post(`/webhooks/${endpointId}/test`, {}, owner.cookie);
    received.length = 0;
    await drain();
    expect(received).toHaveLength(0);
    const latest = (await api.get('/webhooks', owner.cookie)).body.webhooks[0].deliveries[0];
    expect(latest).toMatchObject({ outcome: 'failed', lastError: 'url must be a public address' });
  });

  it('stop for an endpoint that is removed', async () => {
    await api.post(`/webhooks/${endpointId}/test`, {}, owner.cookie);
    expect((await api.delete(`/webhooks/${endpointId}`, owner.cookie)).status).toBe(204);
    process.env.WEBHOOK_ALLOW_PRIVATE = '1';
    received.length = 0;
    await drain();
    expect(received).toHaveLength(0);
    const { rows } = await ownerPool.query(`SELECT outcome FROM job WHERE ref = $1 ORDER BY created_at DESC LIMIT 1`, [endpointId]);
    expect(rows[0].outcome).toBe('cancelled');
  });
});
