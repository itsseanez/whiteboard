// An owner's webhook endpoints. RLS limits every query here to owners of the
// tenant; the secret is returned once, when the endpoint is created.

import { randomBytes, randomUUID } from 'node:crypto';
import { appPool } from '../db.js';
import { webhookUrlProblem } from '../jobs/webhook.js';
import { withContext } from '../withContext.js';
import { NotFoundError, type Scope } from './owner.js';

export class WebhookInputError extends Error {}

const MAX_ENDPOINTS = 5;

export interface Delivery {
  label: string;
  outcome: 'sent' | 'expired' | 'cancelled' | 'failed' | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface Endpoint {
  id: string;
  url: string;
  createdAt: string;
  deliveries: Delivery[];
}

export async function listWebhooks(scope: Scope): Promise<Endpoint[]> {
  return withContext(appPool, scope, async (client) => {
    const endpoints = await client.query<{ id: string; url: string; createdAt: Date }>(
      `SELECT id, url, created_at AS "createdAt" FROM webhook_endpoint ORDER BY created_at`,
    );
    // The join through webhook_endpoint is what scopes job rows to this owner.
    const deliveries = await client.query<Delivery & { ref: string; createdAt: Date }>(
      `SELECT ref, label, outcome, attempts, "lastError", "createdAt" FROM (
         SELECT j.ref, j.label, j.outcome, j.attempts, j.last_error AS "lastError", j.created_at AS "createdAt",
                row_number() OVER (PARTITION BY j.ref ORDER BY j.created_at DESC) AS n
         FROM job j JOIN webhook_endpoint e ON e.id = j.ref) recent
       WHERE n <= 10 ORDER BY "createdAt" DESC`,
    );
    return endpoints.rows.map((e) => ({
      id: e.id,
      url: e.url,
      createdAt: e.createdAt.toISOString(),
      deliveries: deliveries.rows
        .filter((d) => d.ref === e.id)
        .map(({ ref: _ref, createdAt, ...d }) => ({ ...d, createdAt: createdAt.toISOString() })),
    }));
  });
}

export async function addWebhook(scope: Scope, url: string): Promise<{ id: string; url: string; secret: string }> {
  const problem = webhookUrlProblem(url);
  if (problem) throw new WebhookInputError(problem);
  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  return withContext(appPool, scope, async (client) => {
    const count = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM webhook_endpoint');
    if ((count.rows[0]?.n ?? 0) >= MAX_ENDPOINTS) throw new WebhookInputError(`at most ${MAX_ENDPOINTS} webhooks`);
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO webhook_endpoint (tenant_id, url, secret) VALUES ($1, $2, $3) RETURNING id',
      [scope.tenantId, url, secret],
    );
    return { id: rows[0]!.id, url, secret };
  });
}

export async function removeWebhook(scope: Scope, id: string): Promise<void> {
  await withContext(appPool, scope, async (client) => {
    const { rowCount } = await client.query('DELETE FROM webhook_endpoint WHERE id = $1', [id]);
    if (rowCount === 0) throw new NotFoundError();
  });
}

/** Queues a ping, so an owner can see their receiver answer. */
export async function pingWebhook(scope: Scope, id: string): Promise<void> {
  await withContext(appPool, scope, async (client) => {
    const found = await client.query('SELECT 1 FROM webhook_endpoint WHERE id = $1', [id]);
    if (found.rowCount === 0) throw new NotFoundError();
    await client.query(
      `INSERT INTO job (kind, payload, expires_at, ref, label) VALUES ('webhook', $1, now() + interval '1 hour', $2, 'ping')`,
      [{ id: randomUUID(), type: 'ping', createdAt: new Date().toISOString(), data: {} }, id],
    );
  });
}
