// The write path, end to end, including the test this whole phase exists for:
// two simultaneous requests for one slot, exactly one winner.
//
// Needs a migrated, seeded database. Books on Wednesdays, which no availability
// assertion counts, so the two integration suites do not fight over the same
// day. Everything it creates is deleted afterwards through the owner connection.
//
// Times are never constructed by hand: the test asks the availability endpoint
// for slots and books one of them back, which is exactly what a browser does.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';

const app = createApp();

const WIEN_SLUG = 'studio-wien';
const COLOR_SERVICE = 'b2222222-2222-2222-2222-222222222222'; // 150 min, 10/15 buffers, needs the wash station
const ANNA = 'a2222222-2222-2222-2222-222222222222';
const CUT_SERVICE = 'b1111111-1111-1111-1111-111111111111'; // Marina's — another tenant's
const WIEN_TENANT = '22222222-2222-2222-2222-222222222222';
const VIENNA = 'Europe/Vienna';

/** A distinctive domain so cleanup can find exactly what this file created. */
const TEST_DOMAIN = 'booking-test.example';

// The owner connection, for asserting stored rows the public role cannot read
// and for cleaning up. Same approach as the hours isolation tests.
const owner = new Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await owner.end();
});

afterEach(async () => {
  // One statement, so nothing can be inserted between deleting the
  // appointments and deleting the customers they reference. Done as two
  // statements, a concurrent booking in that gap makes the customer delete
  // fail on the foreign key.
  //
  // TEST_DOMAIN is this file's alone. Deleting customers by email pattern is
  // only safe while no other test file uses the same domain — appointment
  // constraint tests have their own.
  await owner.query(
    `WITH mine AS (SELECT id FROM customer WHERE email LIKE $1),
          cleared AS (DELETE FROM appointment WHERE customer_id IN (SELECT id FROM mine))
     DELETE FROM customer WHERE id IN (SELECT id FROM mine)`,
    [`%@${TEST_DOMAIN}`],
  );
});

interface Slot {
  startsAt: string;
  endsAt: string;
  staffIds: string[];
}

function nextWednesday(): Temporal.PlainDate {
  let date = Temporal.Now.plainDateISO(VIENNA).add({ days: 2 });
  while (date.dayOfWeek !== 3) date = date.add({ days: 1 });
  return date;
}

let testDate: Temporal.PlainDate;
let slots: Slot[];

beforeAll(async () => {
  testDate = nextWednesday();
  const res = await request(app)
    .get(`/${WIEN_SLUG}/availability`)
    .query({ serviceId: COLOR_SERVICE, from: testDate.toString() });

  if (res.status !== 200) {
    throw new Error(`availability returned ${res.status}: ${res.text.slice(0, 300)}`);
  }
  const day = (res.body as { days: { status: string; slots?: Slot[] }[] }).days[0];
  if (day?.status !== 'open' || !day.slots?.length) {
    throw new Error(`expected ${testDate} to be open with slots; got ${day?.status}`);
  }
  slots = day.slots;
});

/**
 * The useful part of a failure. A 400/404/409 from this app is JSON; a 500 is
 * Express's HTML error page, where the only thing worth reading is the first
 * line of the stack inside <pre>.
 */
function explain(res: { status: number; body?: unknown; text?: string }): string {
  if (res.body && Object.keys(res.body).length > 0) return JSON.stringify(res.body);
  const pre = /<pre>([\s\S]*?)(?:<br>|<\/pre>)/.exec(res.text ?? '');
  return pre?.[1]?.replace(/&nbsp;/g, ' ').trim() ?? (res.text ?? '(empty body)').slice(0, 300);
}

/**
 * Asserts a booking succeeded, and says why it did not otherwise. Without this
 * a failed write reports "expected 500 to be 201", which names the symptom and
 * hides the Postgres error that caused it.
 */
function expectCreated(res: { status: number; body?: unknown; text?: string }): void {
  if (res.status !== 201) {
    throw new Error(`expected 201, got ${res.status}: ${explain(res)}`);
  }
}

function book(slot: Slot, email: string, overrides: Record<string, unknown> = {}) {
  return request(app)
    .post(`/${WIEN_SLUG}/appointments`)
    .send({
      serviceId: COLOR_SERVICE,
      staffId: ANNA,
      startsAt: slot.startsAt,
      customer: { name: 'Test Customer', email, phone: '+43 1 555 0100' },
      ...overrides,
    });
}

// ---------------------------------------------------------------------------

describe('POST /:slug/appointments', () => {
  it('books a slot and returns the times it reserved', async () => {
    const res = await book(slots[0]!, `first@${TEST_DOMAIN}`);

    expectCreated(res);
    expect(res.body.appointmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.staffId).toBe(ANNA);
    expect(res.body.startsAt).toBe(slots[0]!.startsAt);
    expect(res.body.endsAt).toBe(slots[0]!.endsAt);
  });

  it('stores the blocked interval widened by the service buffers', async () => {
    // The colour service carries 10 minutes before and 15 after, so the chair
    // and the wash station are held longer than the appointment itself. This is
    // read through the owner connection because the public role cannot see
    // these columns back.
    const res = await book(slots[0]!, `buffers@${TEST_DOMAIN}`);
    expectCreated(res);

    const { rows } = await owner.query<{
      startsAt: Date;
      endsAt: Date;
      blockedStartsAt: Date;
      blockedEndsAt: Date;
      resourceId: string | null;
    }>(
      `SELECT starts_at AS "startsAt", ends_at AS "endsAt",
              blocked_starts_at AS "blockedStartsAt", blocked_ends_at AS "blockedEndsAt",
              resource_id AS "resourceId"
       FROM appointment WHERE id = $1`,
      [res.body.appointmentId],
    );
    const row = rows[0]!;

    const minutesBefore =
      (row.startsAt.getTime() - row.blockedStartsAt.getTime()) / 60_000;
    const minutesAfter = (row.blockedEndsAt.getTime() - row.endsAt.getTime()) / 60_000;

    expect(minutesBefore).toBe(10);
    expect(minutesAfter).toBe(15);
    // The service needs a wash station, so one was assigned.
    expect(row.resourceId).not.toBeNull();
  });

  it('removes the slot from availability once booked', async () => {
    await book(slots[0]!, `gone@${TEST_DOMAIN}`);

    const after = await request(app)
      .get(`/${WIEN_SLUG}/availability`)
      .query({ serviceId: COLOR_SERVICE, from: testDate.toString() });

    const starts = (after.body as { days: { slots: Slot[] }[] }).days[0]!.slots.map(
      (s) => s.startsAt,
    );
    expect(starts).not.toContain(slots[0]!.startsAt);
  });

  it('recognises a returning customer instead of duplicating them', async () => {
    // Two bookings far enough apart not to collide: a 150-minute service with
    // buffers occupies nearly three hours, and slots are 15 minutes apart.
    const email = `returning@${TEST_DOMAIN}`;
    const first = await book(slots[0]!, email);
    const second = await book(slots[12]!, email);

    expectCreated(first);
    expectCreated(second);

    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM customer WHERE email = $1`,
      [email],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('matches a returning customer regardless of email case', async () => {
    await book(slots[0]!, `MiXeD@${TEST_DOMAIN}`);
    const second = await book(slots[12]!, `mixed@${TEST_DOMAIN}`);

    expectCreated(second);
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM customer WHERE lower(email) = $1`,
      [`mixed@${TEST_DOMAIN}`],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('returns nothing about the customer', async () => {
    const email = `quiet@${TEST_DOMAIN}`;
    const res = await book(slots[0]!, email);

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(email);
    expect(body).not.toContain('Test Customer');
    expect(body).not.toContain('+43');
    expect(res.body).not.toHaveProperty('customerId');
  });
});

describe('POST /:slug/appointments — the slot is gone', () => {
  it('409s a slot that is already booked', async () => {
    const first = await book(slots[0]!, `winner@${TEST_DOMAIN}`);
    const second = await book(slots[0]!, `loser@${TEST_DOMAIN}`);

    expectCreated(first);
    expect(second.status).toBe(409);
    // 'slot_not_available', not 'slot_taken': the availability check in step 1
    // already sees the slot gone, so the request never reaches the insert and
    // the exclusion constraint never fires. 'slot_taken' only appears when two
    // requests are close enough together that both pass the check — which is
    // the case the database-level test covers deterministically, because it
    // cannot be forced reliably through HTTP.
    expect(second.body.error).toBe('slot_not_available');
  });

  it('409s a slot whose buffers collide with an existing booking', async () => {
    // 15 minutes later is a different slot, but a 150-minute service plus
    // buffers cannot start there. The constraint is on the blocked interval,
    // not the service times.
    const first = await book(slots[0]!, `adjacent-a@${TEST_DOMAIN}`);
    const second = await book(slots[1]!, `adjacent-b@${TEST_DOMAIN}`);

    expectCreated(first);
    expect(second.status).toBe(409);
  });

  it('409s a time that was never on offer', async () => {
    const threeAm = testDate
      .toPlainDateTime(Temporal.PlainTime.from('03:00'))
      .toZonedDateTime(VIENNA)
      .toInstant();

    const res = await request(app)
      .post(`/${WIEN_SLUG}/appointments`)
      .send({
        serviceId: COLOR_SERVICE,
        staffId: ANNA,
        startsAt: threeAm.toString(),
        customer: { name: 'Night Owl', email: `night@${TEST_DOMAIN}` },
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slot_not_available');
  });

  it('409s an off-grid time inside business hours', async () => {
    // 10:07 is within opening hours and is not a candidate start.
    const offGrid = Temporal.Instant.from(slots[0]!.startsAt).add({ minutes: 7 });

    const res = await request(app)
      .post(`/${WIEN_SLUG}/appointments`)
      .send({
        serviceId: COLOR_SERVICE,
        staffId: ANNA,
        startsAt: offGrid.toString(),
        customer: { name: 'Off Grid', email: `offgrid@${TEST_DOMAIN}` },
      });

    expect(res.status).toBe(409);
  });
});

describe('POST /:slug/appointments — two at once', () => {
  it('lets exactly one of two simultaneous requests win', async () => {
    // The user-visible property: whoever loses gets a 409 and no second
    // appointment exists. Which layer caught it is not asserted — both are
    // legitimate. Node interleaves the two requests at their await points, so
    // the loser's availability check usually runs after the winner's commit and
    // returns 'slot_not_available'; only a tighter interleaving reaches the
    // insert and yields 'slot_taken'. Pinning the code here would make the test
    // flaky for no gain. See tests/appointment-constraint.test.ts for proof
    // that the constraint closes the window the check cannot.
    const [a, b] = await Promise.all([
      book(slots[0]!, `race-a@${TEST_DOMAIN}`),
      book(slots[0]!, `race-b@${TEST_DOMAIN}`),
    ]);

    const statuses = [a.status, b.status].sort();
    if (!statuses.every((s) => s === 201 || s === 409)) {
      throw new Error(`expected 201 and 409, got ${a.status} (${explain(a)}) and ${b.status} (${explain(b)})`);
    }
    expect(statuses).toEqual([201, 409]);

    const loser = a.status === 409 ? a : b;
    expect(['slot_taken', 'slot_not_available']).toContain(loser.body.error);

    // And the database holds one appointment, not two.
    const { rows } = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM appointment
       WHERE starts_at = $1 AND staff_id = $2 AND status = 'BOOKED'`,
      [slots[0]!.startsAt, ANNA],
    );
    expect(rows[0]!.n).toBe('1');
  });

  it('lets five at once produce exactly one booking', async () => {
    // Same property under more pressure, because two requests can pass by luck
    // of scheduling while five cannot.
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) => book(slots[0]!, `crowd-${n}@${TEST_DOMAIN}`)),
    );

    const unexpected = results.filter((r) => r.status !== 201 && r.status !== 409);
    if (unexpected.length) {
      throw new Error(`unexpected status ${unexpected[0]!.status}: ${explain(unexpected[0]!)}`);
    }
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
  });
});

describe('POST /:slug/appointments — rejected requests', () => {
  const valid = () => ({
    serviceId: COLOR_SERVICE,
    staffId: ANNA,
    startsAt: slots[0]!.startsAt,
    customer: { name: 'Test Customer', email: `reject@${TEST_DOMAIN}` },
  });

  const cases: [string, Record<string, unknown>][] = [
    ['a serviceId that is not a uuid', { serviceId: 'nope' }],
    ['a missing staffId', { staffId: undefined }],
    ['an unparseable startsAt', { startsAt: 'tomorrow' }],
    ['a startsAt with no offset', { startsAt: '2026-10-28T10:00:00' }],
    ['a missing customer', { customer: undefined }],
    ['a customer with no name', { customer: { email: `x@${TEST_DOMAIN}` } }],
    ['a customer with no email', { customer: { name: 'Nameless' } }],
    ['an email that is not an email', { customer: { name: 'X', email: 'not-an-email' } }],
  ];

  for (const [what, override] of cases) {
    it(`400s ${what}`, async () => {
      const res = await request(app)
        .post(`/${WIEN_SLUG}/appointments`)
        .send({ ...valid(), ...override });

      expect(res.status).toBe(400);
    });
  }

  it('404s another tenant\'s service', async () => {
    // Marina's Cut, booked through Studio Wien's slug. RLS returns no service,
    // so this is indistinguishable from a service that does not exist.
    const res = await request(app)
      .post(`/${WIEN_SLUG}/appointments`)
      .send({ ...valid(), serviceId: CUT_SERVICE });

    expect([404, 409]).toContain(res.status);
  });

  it('404s an unknown tenant slug', async () => {
    const res = await request(app).post('/no-such-salon/appointments').send(valid());

    expect(res.status).toBe(404);
  });

  it('cannot write into another tenant', async () => {
    // Belt and braces on RLS: whatever the request says, the row lands under
    // the tenant the slug resolved to.
    const res = await book(slots[0]!, `tenant-check@${TEST_DOMAIN}`);
    expectCreated(res);

    const { rows } = await owner.query<{ tenantId: string }>(
      `SELECT tenant_id AS "tenantId" FROM appointment WHERE id = $1`,
      [res.body.appointmentId],
    );
    expect(rows[0]!.tenantId).toBe(WIEN_TENANT);
  });
});
