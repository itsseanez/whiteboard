// Proof that the exclusion constraints — not the application's availability
// check — are what make concurrent booking safe.
//
// The endpoint test cannot show this. Node interleaves two HTTP requests at
// their await points, so the second request's availability check almost always
// runs after the first has committed and refuses the booking before any insert
// happens. That is a perfectly good outcome, but it means the endpoint test
// proves the check works while saying nothing about the window the check cannot
// close: two requests that both pass the check and both reach the insert.
//
// Two database connections in hand-held transactions reproduce that window
// exactly, every time. The behaviour to demonstrate is not just "the second
// insert fails" — it is that the second insert BLOCKS until the first commits,
// which is why no amount of unlucky timing can let both through.
//
// These run as the owner, which bypasses RLS. The point here is the constraint,
// not tenancy; the public role's view of it is covered by the endpoint test.

import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });

const TENANT = '22222222-2222-2222-2222-222222222222';
const ANNA = 'a2222222-2222-2222-2222-222222222222';
const COLOR_SERVICE = 'b2222222-2222-2222-2222-222222222222';
const WASH_STATION = 'c2222222-2222-2222-2222-222222222222';

/** Far enough out that nothing else in the suite books near it. */
const BASE = '2027-06-02T08:00:00Z';

// Its own domain, deliberately NOT shared with booking-endpoint.test.ts: that
// file's cleanup deletes customers by email pattern, and a shared domain means
// each file deletes the other's fixtures the moment the two run concurrently.
const CUSTOMER_EMAIL = 'fixture@appointment-constraint.example';
let customerId: string | undefined;

async function testCustomer(): Promise<string> {
  if (customerId) return customerId;
  const { rows } = await owner.query<{ id: string }>(
    `INSERT INTO customer (tenant_id, name, email)
     VALUES ($1, 'Constraint Test', $2)
     ON CONFLICT (tenant_id, lower(email)) DO UPDATE SET phone = customer.phone
     RETURNING id`,
    [TENANT, CUSTOMER_EMAIL],
  );
  customerId = rows[0]!.id;
  return customerId;
}

function minutesFromBase(minutes: number): string {
  return Temporal.Instant.from(BASE).add({ minutes }).toString();
}

/**
 * An insert as raw SQL, so a transaction can be driven statement by statement.
 * `staffId` and `resourceId` are nullable to exercise the two constraints
 * independently.
 */
async function insertAppointment(
  client: PoolClient | Pool,
  options: {
    startMinutes: number;
    durationMinutes?: number;
    staffId?: string | null;
    resourceId?: string | null;
    status?: string;
  },
): Promise<string> {
  const duration = options.durationMinutes ?? 60;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO appointment (
       tenant_id, staff_id, service_id, resource_id, customer_id,
       starts_at, ends_at, blocked_starts_at, blocked_ends_at, status
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $6, $7, $8)
     RETURNING id`,
    [
      TENANT,
      options.staffId === undefined ? ANNA : options.staffId,
      COLOR_SERVICE,
      options.resourceId ?? null,
      await testCustomer(),
      minutesFromBase(options.startMinutes),
      minutesFromBase(options.startMinutes + duration),
      options.status ?? 'BOOKED',
    ],
  );
  return rows[0]!.id;
}

afterEach(async () => {
  // By customer, not by time range: it cannot miss a row this file created and
  // cannot touch one it did not.
  if (customerId) {
    await owner.query(`DELETE FROM appointment WHERE customer_id = $1`, [customerId]);
  }
});

afterAll(async () => {
  await owner.query(`DELETE FROM customer WHERE email = $1`, [CUSTOMER_EMAIL]);
  await owner.end();
});

/**
 * Returns a client to the pool safely.
 *
 * A client whose statement was rejected is still inside an aborted
 * transaction. release() does not reset it, so without this the next query on
 * that connection — from anywhere, including an afterEach — fails with
 * "current transaction is aborted, commands ignored until end of transaction
 * block", and the real failure is buried under a cascade of unrelated ones.
 */
async function finish(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Already resolved, or the connection is gone. Either is fine.
  }
  client.release();
}

/** Resolves to 'pending' if the promise has not settled within `ms`. */
async function settledWithin<T>(promise: Promise<T>, ms: number): Promise<'pending' | 'settled'> {
  const timer = new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), ms));
  return Promise.race([promise.then(() => 'settled' as const).catch(() => 'settled' as const), timer]);
}

// ---------------------------------------------------------------------------

describe('appointment exclusion constraints', () => {
  it('blocks the second transaction until the first commits, then rejects it', async () => {
    // The mechanism, in full. This is the test that earns the phase gate.
    const a = await owner.connect();
    const b = await owner.connect();

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      await insertAppointment(a, { startMinutes: 0, durationMinutes: 60 });

      // Overlaps by 30 minutes. Not awaited: it must not resolve yet.
      const blocked = insertAppointment(b, { startMinutes: 30, durationMinutes: 60 });
      const swallow = blocked.catch(() => undefined); // keep it from going unhandled

      // Still waiting on A's uncommitted row — this is the lock that makes the
      // whole scheme work. Without it, B would see nothing and commit happily.
      expect(await settledWithin(swallow, 400)).toBe('pending');

      await a.query('COMMIT');

      // Now A's row is visible and B is refused.
      await expect(blocked).rejects.toMatchObject({ code: '23P01' });
      await b.query('ROLLBACK');
    } finally {
      await finish(a);
      await finish(b);
    }

    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM appointment WHERE starts_at >= $1`,
      [BASE],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('lets the loser succeed once the winner rolls back', async () => {
    // The other half: blocking is not a permanent refusal. If the first
    // transaction abandons the booking, the second gets the slot.
    const a = await owner.connect();
    const b = await owner.connect();

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      await insertAppointment(a, { startMinutes: 0 });
      const waiting = insertAppointment(b, { startMinutes: 30 });

      expect(await settledWithin(waiting.catch(() => undefined), 300)).toBe('pending');

      await a.query('ROLLBACK');

      await expect(waiting).resolves.toMatch(/^[0-9a-f-]{36}$/);
      await b.query('COMMIT');
    } finally {
      await finish(a);
      await finish(b);
    }
  });

  it('allows back-to-back bookings in concurrent transactions', async () => {
    // Touching is not overlapping, so these must not block each other at all.
    const a = await owner.connect();
    const b = await owner.connect();

    try {
      await a.query('BEGIN');
      await b.query('BEGIN');

      await insertAppointment(a, { startMinutes: 0, durationMinutes: 60 });
      const second = insertAppointment(b, { startMinutes: 60, durationMinutes: 60 });

      // No wait at all — asserted by it having settled before A commits.
      expect(await settledWithin(second, 400)).toBe('settled');
      await expect(second).resolves.toBeTruthy();

      await a.query('COMMIT');
      await b.query('COMMIT');
    } finally {
      await finish(a);
      await finish(b);
    }

    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM appointment WHERE starts_at >= $1`,
      [BASE],
    );
    expect(rows[0]!.n).toBe('2');
  });

  it('constrains resources independently of staff', async () => {
    // Two different stylists cannot share one wash station. The staff
    // constraint has nothing to say here; the resource one does.
    await insertAppointment(owner, {
      startMinutes: 0,
      staffId: ANNA,
      resourceId: WASH_STATION,
    });

    await expect(
      insertAppointment(owner, {
        startMinutes: 30,
        staffId: null, // no staff conflict possible
        resourceId: WASH_STATION,
      }),
    ).rejects.toMatchObject({ code: '23P01' });
  });

  it('does not make two unstaffed, resourceless bookings conflict', async () => {
    // Both columns null means neither constraint applies — NULL = NULL never
    // matches. Nonsense data, but it must not error, because the partial
    // indexes depend on this being true.
    await insertAppointment(owner, { startMinutes: 0, staffId: null, resourceId: null });
    await expect(
      insertAppointment(owner, { startMinutes: 30, staffId: null, resourceId: null }),
    ).resolves.toBeTruthy();
  });

  it('frees the slot when an appointment is cancelled', async () => {
    const id = await insertAppointment(owner, { startMinutes: 0 });
    await expect(insertAppointment(owner, { startMinutes: 30 })).rejects.toMatchObject({
      code: '23P01',
    });

    await owner.query(`UPDATE appointment SET status = 'CANCELLED' WHERE id = $1`, [id]);

    await expect(insertAppointment(owner, { startMinutes: 30 })).resolves.toBeTruthy();
  });

  it('frees the slot for a no-show too', async () => {
    const id = await insertAppointment(owner, { startMinutes: 0 });
    await owner.query(`UPDATE appointment SET status = 'NO_SHOW' WHERE id = $1`, [id]);

    await expect(insertAppointment(owner, { startMinutes: 30 })).resolves.toBeTruthy();
  });

  it('refuses a status outside the allowed set', async () => {
    await expect(
      insertAppointment(owner, { startMinutes: 0, status: 'PENCILLED_IN' }),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
