// backend/tests/manage-booking-endpoint.test.ts
//
// Cancel and reschedule, end to end, including the one test that fails on
// otherwise-correct code: rescheduling an appointment to a time that overlaps
// where it already sits.
//
// Needs a migrated, seeded database. Books on Thursdays, so it never competes
// for a day with booking-endpoint.test.ts (Wednesdays) or with the availability
// assertions (Tuesdays). Its own customer email domain, because the cleanup
// here deletes by email pattern and a shared domain means two files deleting
// each other's fixtures.
//
// Times are never constructed by hand: every test asks the availability
// endpoint for slots and sends one back, which is what a browser does.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../src/app.js';

const app = createApp();

const WIEN_SLUG = 'studio-wien';
const MARINA_SLUG = 'marinas-cuts-color';
const COLOR_SERVICE = 'b2222222-2222-2222-2222-222222222222'; // 150 min, 10/15 buffers, wash station
const ANNA = 'a2222222-2222-2222-2222-222222222222';
const VIENNA = 'Europe/Vienna';

const TEST_DOMAIN = 'manage-test.example';

const owner = new Pool({ connectionString: process.env.DATABASE_URL });

afterAll(async () => {
  await owner.end();
});

afterEach(async () => {
  // One statement, so no concurrent booking can land between the appointment
  // delete and the customer delete and break the foreign key.
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

function nextThursday(): Temporal.PlainDate {
  let date = Temporal.Now.plainDateISO(VIENNA).add({ days: 2 });
  while (date.dayOfWeek !== 4) date = date.add({ days: 1 });
  return date;
}

let testDate: Temporal.PlainDate;

/** Fresh slots for the test date, with an appointment optionally disregarded. */
async function fetchSlots(date: Temporal.PlainDate): Promise<Slot[]> {
  const res = await request(app)
    .get(`/${WIEN_SLUG}/availability`)
    .query({ serviceId: COLOR_SERVICE, from: date.toString() });

  if (res.status !== 200) {
    throw new Error(`availability returned ${res.status}: ${res.text.slice(0, 300)}`);
  }
  const day = (res.body as { days: { status: string; slots?: Slot[] }[] }).days[0];
  if (day?.status !== 'open' || !day.slots?.length) {
    throw new Error(`expected ${date} to be open with slots; got ${day?.status}`);
  }
  return day.slots;
}

let slots: Slot[];

beforeAll(async () => {
  testDate = nextThursday();
  slots = await fetchSlots(testDate);
  if (slots.length < 3) {
    throw new Error(`need at least 3 slots on ${testDate}; got ${slots.length}`);
  }
});

function explain(res: { status: number; body?: unknown; text?: string }): string {
  if (res.body && Object.keys(res.body).length > 0) return JSON.stringify(res.body);
  const pre = /<pre>([\s\S]*?)(?:<br>|<\/pre>)/.exec(res.text ?? '');
  return pre?.[1]?.replace(/&nbsp;/g, ' ').trim() ?? (res.text ?? '(empty body)').slice(0, 300);
}

interface Booked {
  appointmentId: string;
  manageToken: string;
  startsAt: string;
  endsAt: string;
}

/** Books a slot and returns the 201 body, failing loudly with the real error. */
async function book(slot: Slot, email: string): Promise<Booked> {
  const res = await request(app)
    .post(`/${WIEN_SLUG}/appointments`)
    .send({
      serviceId: COLOR_SERVICE,
      staffId: ANNA,
      startsAt: slot.startsAt,
      customer: { name: 'Manage Test', email },
    });
  if (res.status !== 201) {
    throw new Error(`expected 201 booking ${slot.startsAt}, got ${res.status}: ${explain(res)}`);
  }
  return res.body as Booked;
}

function cancel(token: string, slug = WIEN_SLUG) {
  return request(app).post(`/${slug}/appointments/cancel`).send({ token });
}

function reschedule(token: string, body: Record<string, unknown>, slug = WIEN_SLUG) {
  return request(app).post(`/${slug}/appointments/reschedule`).send({ token, ...body });
}

async function storedRow(id: string) {
  const { rows } = await owner.query<{
    status: string;
    startsAt: Date;
    endsAt: Date;
    staffId: string;
    blockedStartsAt: Date;
    blockedEndsAt: Date;
    manageTokenHash: string;
  }>(
    `SELECT status,
            starts_at         AS "startsAt",
            ends_at           AS "endsAt",
            staff_id          AS "staffId",
            blocked_starts_at AS "blockedStartsAt",
            blocked_ends_at   AS "blockedEndsAt",
            manage_token_hash AS "manageTokenHash"
     FROM appointment WHERE id = $1`,
    [id],
  );
  return rows[0];
}

// ---------------------------------------------------------------------------

describe('the manage token', () => {
  it('is returned once at booking and stored only as a hash', async () => {
    const booked = await book(slots[0]!, `token@${TEST_DOMAIN}`);

    // 32 bytes, base64url: 43 characters, no padding, URL-safe alphabet.
    expect(booked.manageToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = await storedRow(booked.appointmentId);
    expect(row!.manageTokenHash).toMatch(/^[0-9a-f]{64}$/);
    // The plaintext is nowhere in the row. This is the property the whole
    // hashing decision exists for.
    expect(row!.manageTokenHash).not.toBe(booked.manageToken);
    expect(row!.manageTokenHash).not.toContain(booked.manageToken);
  });

  it('is rejected when it belongs to another tenant', async () => {
    const booked = await book(slots[0]!, `crosstenant@${TEST_DOMAIN}`);

    // A real, live token — presented to the wrong salon. RLS makes it
    // indistinguishable from a wrong token, which is the point: the response
    // must not confirm the token is valid somewhere.
    const res = await cancel(booked.manageToken, MARINA_SLUG);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'appointment_not_found' });

    // And it still works against its own tenant afterwards.
    await expect(cancel(booked.manageToken).then((r) => r.status)).resolves.toBe(200);
  });

  it('rejects an unknown token with 404, not 400', async () => {
    // A well-formed token that matches nothing, and a malformed one, must be
    // indistinguishable — otherwise the shape check is an oracle telling a
    // prober which guesses were at least the right format.
    const wellFormed = await cancel('A'.repeat(43));
    const malformed = await cancel('not-a-token');
    expect(wellFormed.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(wellFormed.body).toEqual(malformed.body);
  });
});

describe('POST /:slug/appointments/cancel', () => {
  it('cancels a booked appointment', async () => {
    const booked = await book(slots[0]!, `cancel@${TEST_DOMAIN}`);

    const res = await cancel(booked.manageToken);
    expect(res.status, explain(res)).toBe(200);
    expect(res.body).toEqual({
      appointmentId: booked.appointmentId,
      status: 'CANCELLED',
      cancelled: true,
    });

    expect((await storedRow(booked.appointmentId))!.status).toBe('CANCELLED');
  });

  it('is idempotent on a second click of the same link', async () => {
    const booked = await book(slots[0]!, `twice@${TEST_DOMAIN}`);

    await cancel(booked.manageToken);
    const second = await cancel(booked.manageToken);

    // 200, not 409. Clicking the link in the email twice is the ordinary case,
    // and an error there reads as "your cancellation failed" when it did not.
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ status: 'CANCELLED', cancelled: false });
  });

  it('refuses to cancel an appointment that has already happened', async () => {
    // Booked normally, then moved into the past behind the API's back — there
    // is no way to book a past slot through the endpoint, which is the point.
    const booked = await book(slots[0]!, `past@${TEST_DOMAIN}`);
    await owner.query(
      `UPDATE appointment
       SET starts_at = now() - interval '2 hours',
           ends_at   = now() - interval '30 minutes',
           blocked_starts_at = now() - interval '2 hours',
           blocked_ends_at   = now() - interval '30 minutes'
       WHERE id = $1`,
      [booked.appointmentId],
    );

    const res = await cancel(booked.manageToken);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'already_started' });

    // Still BOOKED. Whether it was a no-show is the owner's call to record.
    expect((await storedRow(booked.appointmentId))!.status).toBe('BOOKED');
  });

  it('refuses to cancel a completed appointment', async () => {
    const booked = await book(slots[0]!, `done@${TEST_DOMAIN}`);
    await owner.query(`UPDATE appointment SET status = 'COMPLETED' WHERE id = $1`, [
      booked.appointmentId,
    ]);

    const res = await cancel(booked.manageToken);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'not_booked' });
  });

  it('frees the slot for somebody else', async () => {
    const target = slots[0]!;
    const booked = await book(target, `frees@${TEST_DOMAIN}`);

    const whileBooked = await fetchSlots(testDate);
    expect(whileBooked.map((s) => s.startsAt)).not.toContain(target.startsAt);

    await cancel(booked.manageToken);

    const afterCancel = await fetchSlots(testDate);
    expect(afterCancel.map((s) => s.startsAt)).toContain(target.startsAt);
  });

  it('rejects a request with no token', async () => {
    const res = await request(app).post(`/${WIEN_SLUG}/appointments/cancel`).send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /:slug/appointments/reschedule', () => {
  it('moves an appointment to another free slot', async () => {
    const from = slots[0]!;
    const to = slots[slots.length - 1]!;
    const booked = await book(from, `move@${TEST_DOMAIN}`);

    const res = await reschedule(booked.manageToken, { startsAt: to.startsAt });
    expect(res.status, explain(res)).toBe(200);
    expect(res.body).toMatchObject({
      appointmentId: booked.appointmentId,
      staffId: ANNA,
      startsAt: to.startsAt,
      endsAt: to.endsAt,
    });

    const row = await storedRow(booked.appointmentId);
    expect(row!.startsAt.toISOString()).toBe(new Date(to.startsAt).toISOString());
    expect(row!.status).toBe('BOOKED');

    // Buffers re-applied from the service: 10 before, 15 after.
    expect(row!.blockedStartsAt.getTime()).toBe(new Date(to.startsAt).getTime() - 10 * 60_000);
    expect(row!.blockedEndsAt.getTime()).toBe(new Date(to.endsAt).getTime() + 15 * 60_000);
  });

  // ---------------------------------------------------------------------
  // THE TEST THIS FEATURE EXISTS FOR.
  //
  // Moving an appointment by 15 minutes overlaps its own current position.
  // Without excludeAppointmentId in the availability query, the appointment's
  // own row reports itself busy, the courtesy check refuses, and the customer
  // gets 409 slot_not_available for a slot that is genuinely free. The database
  // would have accepted it — an exclusion constraint compares a row against
  // OTHER rows — so this is a bug the engine invents on its own.
  //
  // It fails on code that is otherwise entirely correct, which is why it is
  // worth having.
  // ---------------------------------------------------------------------
  it('moves an appointment onto a time overlapping its own current slot', async () => {
    const from = slots[0]!;
    const booked = await book(from, `overlap@${TEST_DOMAIN}`);

    // The slots adjacent to `from` are 15 minutes apart on the grid, so the
    // next one necessarily overlaps a 150-minute appointment.
    const nudged = Temporal.Instant.from(from.startsAt).add({ minutes: 15 });

    const res = await reschedule(booked.manageToken, { startsAt: nudged.toString() });
    expect(res.status, explain(res)).toBe(200);

    const row = await storedRow(booked.appointmentId);
    expect(row!.startsAt.toISOString()).toBe(new Date(nudged.epochMilliseconds).toISOString());
  });

  it('leaves the token working, so a second reschedule succeeds', async () => {
    const booked = await book(slots[0]!, `again@${TEST_DOMAIN}`);

    const first = await reschedule(booked.manageToken, { startsAt: slots[1]!.startsAt });
    expect(first.status, explain(first)).toBe(200);

    // Same token. This is what rescheduling in place buys over
    // cancel-and-rebook, which would have killed the customer's link.
    const second = await reschedule(booked.manageToken, {
      startsAt: slots[slots.length - 1]!.startsAt,
    });
    expect(second.status, explain(second)).toBe(200);
    expect(second.body).toMatchObject({ appointmentId: booked.appointmentId });
  });

  it('refuses a time that is not on offer', async () => {
    const booked = await book(slots[0]!, `closed@${TEST_DOMAIN}`);

    // 03:00 local, which no salon in the seed is open for.
    const middleOfTheNight = testDate
      .toPlainDateTime(Temporal.PlainTime.from('03:00'))
      .toZonedDateTime(VIENNA)
      .toInstant();

    const res = await reschedule(booked.manageToken, { startsAt: middleOfTheNight.toString() });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'slot_not_available' });
  });

  it('refuses a slot another customer already holds', async () => {
    const mine = slots[0]!;
    const theirs = slots[slots.length - 1]!;

    const booked = await book(mine, `mover@${TEST_DOMAIN}`);
    await book(theirs, `holder@${TEST_DOMAIN}`);

    const res = await reschedule(booked.manageToken, { startsAt: theirs.startsAt });
    // 409 either way: slot_not_available if the courtesy check caught it,
    // slot_taken if it got as far as the constraint. Both are correct, and
    // which one happens is a timing detail the test must not depend on.
    expect(res.status).toBe(409);
    expect(['slot_not_available', 'slot_taken']).toContain((res.body as { error: string }).error);

    // Unmoved.
    const row = await storedRow(booked.appointmentId);
    expect(row!.startsAt.toISOString()).toBe(new Date(mine.startsAt).toISOString());
  });

  it('refuses to reschedule a cancelled appointment', async () => {
    const booked = await book(slots[0]!, `dead@${TEST_DOMAIN}`);
    await cancel(booked.manageToken);

    const res = await reschedule(booked.manageToken, { startsAt: slots[1]!.startsAt });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'not_booked' });
  });

  it('rejects an unknown token with 404', async () => {
    const res = await reschedule('A'.repeat(43), { startsAt: slots[0]!.startsAt });
    expect(res.status).toBe(404);
  });

  it('rejects a startsAt with no offset', async () => {
    const booked = await book(slots[0]!, `naive@${TEST_DOMAIN}`);
    // A bare local time must never be silently read in some zone.
    const res = await reschedule(booked.manageToken, { startsAt: '2027-06-02T09:00' });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed staffId', async () => {
    const booked = await book(slots[0]!, `badstaff@${TEST_DOMAIN}`);
    const res = await reschedule(booked.manageToken, {
      startsAt: slots[1]!.startsAt,
      staffId: 'anna',
    });
    expect(res.status).toBe(400);
  });

  it('rejects a request with no startsAt', async () => {
    const booked = await book(slots[0]!, `nostart@${TEST_DOMAIN}`);
    const res = await reschedule(booked.manageToken, {});
    expect(res.status).toBe(400);
  });
});
