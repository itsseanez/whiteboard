// The only test that exercises the whole availability path: route → tenant
// middleware → fetch as whiteboard_public under RLS → mapper → engine →
// response shaping. The 100-odd tests in tests/availability/ are pure and need
// no database; this one needs a migrated, seeded one, which is why it lives up
// here with the other integration tests rather than beside them.
//
// It exists because the pure tests cannot fail for any of the reasons this path
// actually breaks: a missing column grant, a renamed column alias, a mapper
// that groups by the wrong key. All of those leave the engine suite green and
// the endpoint returning 500.
//
// Depends on seed-demo-tenants and seed-demo-availability, both applied by
// `npm run migrate:test up`.
//
// NOTHING HERE IS DATE-PINNED, on purpose. The controller reads the real clock,
// so a hard-coded October 2026 window would start failing the moment it fell
// into the past: minimum notice would mark every slot 'tooSoon'. Dates are
// derived from today, and the clock-change boundary is found at runtime.

import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

const WIEN_SLUG = 'studio-wien';
const MARINA_SLUG = 'marinas-cuts-color';
const VIENNA = 'Europe/Vienna';
const NEW_YORK = 'America/New_York';

const COLOR_SERVICE = 'b2222222-2222-2222-2222-222222222222'; // Studio Wien, 150 min, needs the wash station
const CUT_SERVICE = 'b1111111-1111-1111-1111-111111111111'; // Marina's, 45 min
const ABSENT_SERVICE = '00000000-0000-0000-0000-000000000000';

interface Slot {
  startsAt: string;
  endsAt: string;
  staffIds: string[];
  resourceIds?: string[]; // must NOT be present — asserted below
}
interface Day {
  date: string;
  status: 'open' | 'closed';
  slots?: Slot[];
  excluded?: unknown; // must NOT be present — asserted below
}
interface Body {
  timeZone: string;
  noQualifiedStaff: boolean;
  days: Day[];
}

function get(slug: string, params: Record<string, string>) {
  return request(app).get(`/${slug}/availability`).query(params);
}

/**
 * A successful response, or a failure that says what actually came back.
 *
 * Without this, a 500 surfaces as "Cannot read properties of undefined
 * (reading 'find')" from the helper below, which tells you nothing. The usual
 * cause is the test database not being migrated — `npm run migrate:test up` —
 * and the body here names it directly.
 */
async function fetchBody(slug: string, params: Record<string, string>): Promise<Body> {
  const res = await get(slug, params);
  if (res.status !== 200) {
    throw new Error(`GET /${slug}/availability expected 200, got ${res.status}: ${explain(res)}`);
  }
  return res.body as Body;
}

/**
 * The useful part of a failure. A 400 or 404 from this app is JSON; a 500 is
 * Express's HTML error page, where the only thing worth reading is the first
 * line of the stack inside <pre>.
 */
function explain(res: { body?: unknown; text?: string }): string {
  if (res.body && Object.keys(res.body).length > 0) return JSON.stringify(res.body);
  const pre = /<pre>([\s\S]*?)(?:<br>|<\/pre>)/.exec(res.text ?? '');
  return pre?.[1]?.replace(/&nbsp;/g, ' ').trim() ?? (res.text ?? '(empty body)').slice(0, 200);
}

/** The local time of day a slot starts, on the business's clock: "10:00". */
function localTime(iso: string, timeZone: string): string {
  return Temporal.Instant.from(iso)
    .toZonedDateTimeISO(timeZone)
    .toPlainTime()
    .toString()
    .slice(0, 5);
}

function day(body: Body, date: Temporal.PlainDate): Day {
  if (!body.days) throw new Error(`response has no days: ${JSON.stringify(body)}`);
  const found = body.days.find((d) => d.date === date.toString());
  if (!found) throw new Error(`no day ${date} in response: ${body.days.map((d) => d.date).join()}`);
  return found;
}

function openDay(body: Body, date: Temporal.PlainDate): Slot[] {
  const d = day(body, date);
  if (d.status !== 'open' || !d.slots) throw new Error(`expected ${date} open, got ${d.status}`);
  return d.slots;
}

/** The next date with this ISO weekday, at least `minDaysAhead` days out. */
function nextWeekday(weekday: number, timeZone: string, minDaysAhead = 2): Temporal.PlainDate {
  let date = Temporal.Now.plainDateISO(timeZone).add({ days: minDaysAhead });
  while (date.dayOfWeek !== weekday) date = date.add({ days: 1 });
  return date;
}

/**
 * The next clock change in this zone that is far enough ahead to be bookable,
 * together with the Tuesday either side of it.
 *
 * Both regions always shift on a Sunday, so the Tuesday before is the Sunday
 * minus five days and the Tuesday after is plus two. Tuesdays because both demo
 * tenants are open on them, and because using the same weekday on both sides
 * means the expected local times are identical — which is the whole assertion.
 */
function straddleNextTransition(timeZone: string) {
  let probe = Temporal.Now.instant().toZonedDateTimeISO(timeZone);
  for (let i = 0; i < 6; i++) {
    const transition = probe.getTimeZoneTransition('next');
    if (!transition) throw new Error(`${timeZone} has no upcoming clock change`);
    const sunday = transition.toPlainDate();
    const before = sunday.subtract({ days: 5 });
    // Skip a transition whose leading Tuesday is already here — minimum notice
    // would start excluding its morning and the counts would not match.
    if (Temporal.PlainDate.compare(before, Temporal.Now.plainDateISO(timeZone).add({ days: 2 })) >= 0) {
      return { sunday, before, after: sunday.add({ days: 2 }) };
    }
    probe = transition;
  }
  throw new Error('no suitable transition found');
}

// ---------------------------------------------------------------------------

describe('GET /:slug/availability', () => {
  it('returns the tenant zone and a day per requested date', async () => {
    const from = nextWeekday(1, VIENNA); // a Monday
    const body = await fetchBody(WIEN_SLUG, {
      serviceId: COLOR_SERVICE,
      from: from.toString(),
      through: from.add({ days: 4 }).toString(),
    });

    expect(body.timeZone).toBe(VIENNA);
    expect(body.noQualifiedStaff).toBe(false);
    expect(body.days.map((d) => d.date)).toEqual([
      from.toString(),
      from.add({ days: 1 }).toString(),
      from.add({ days: 2 }).toString(),
      from.add({ days: 3 }).toString(),
      from.add({ days: 4 }).toString(),
    ]);
  });

  it('offers the hours the seed describes: 10:00 to 15:30 for a 150-minute colour', async () => {
    // Studio Wien opens 10:00-20:00 and Anna works until 18:00, so the last
    // start that finishes inside her shift is 15:30 — the business hours are not
    // the binding constraint, her shift is.
    const tuesday = nextWeekday(2, VIENNA);
    const body = await fetchBody(WIEN_SLUG, { serviceId: COLOR_SERVICE, from: tuesday.toString() });

    const slots = openDay(body, tuesday);
    expect(slots).toHaveLength(23);
    expect(localTime(slots[0]!.startsAt, VIENNA)).toBe('10:00');
    expect(localTime(slots.at(-1)!.startsAt, VIENNA)).toBe('15:30');
  });

  it('keeps every slot exactly the service duration', async () => {
    const tuesday = nextWeekday(2, VIENNA);
    const body = await fetchBody(WIEN_SLUG, { serviceId: COLOR_SERVICE, from: tuesday.toString() });

    for (const slot of openDay(body, tuesday)) {
      const minutes = Temporal.Instant.from(slot.endsAt)
        .since(Temporal.Instant.from(slot.startsAt))
        .total('minutes');
      expect(minutes).toBe(150);
    }
  });

  it('puts every start on a local quarter hour', async () => {
    const tuesday = nextWeekday(2, VIENNA);
    const body = await fetchBody(WIEN_SLUG, { serviceId: COLOR_SERVICE, from: tuesday.toString() });

    for (const slot of openDay(body, tuesday)) {
      const minute = Temporal.Instant.from(slot.startsAt).toZonedDateTimeISO(VIENNA).minute;
      expect(minute % 15).toBe(0);
    }
  });

  it('marks days the business is shut as closed, with no slots key at all', async () => {
    const saturday = nextWeekday(6, VIENNA);
    const body = await fetchBody(WIEN_SLUG, {
      serviceId: COLOR_SERVICE,
      from: saturday.toString(),
      through: saturday.add({ days: 1 }).toString(),
    });

    expect(day(body, saturday)).toEqual({ date: saturday.toString(), status: 'closed' });
    expect(day(body, saturday.add({ days: 1 }))).toEqual({
      date: saturday.add({ days: 1 }).toString(),
      status: 'closed',
    });
  });
});

describe('GET /:slug/availability — across a clock change', () => {
  it('keeps the local time identical and the moment an hour apart', async () => {
    // The phase gate, through the whole stack rather than in a unit test.
    //
    // Two Tuesdays either side of the next Vienna clock change. Both should open
    // at 10:00 on the salon's wall clock, and the two moments should be 167 or
    // 169 hours apart rather than the 168 of a seven-day week: one hour is
    // gained or lost in between.
    //
    // Asserting only the local times would pass on code that computed every day
    // with one offset. Asserting only the moments would pass on code that let
    // the wall clock drift. Together they will not.
    const { before, after } = straddleNextTransition(VIENNA);

    const body = await fetchBody(WIEN_SLUG, {
      serviceId: COLOR_SERVICE,
      from: before.toString(),
      through: after.toString(),
    });

    const beforeFirst = openDay(body, before)[0]!;
    const afterFirst = openDay(body, after)[0]!;

    expect(localTime(beforeFirst.startsAt, VIENNA)).toBe('10:00');
    expect(localTime(afterFirst.startsAt, VIENNA)).toBe('10:00');

    const hours = Temporal.Instant.from(afterFirst.startsAt)
      .since(Temporal.Instant.from(beforeFirst.startsAt))
      .total('hours');
    expect(hours).not.toBe(168);
    expect([167, 169]).toContain(hours);

    // And the offsets themselves differ, which is the underlying fact.
    const offsetBefore = Temporal.Instant.from(beforeFirst.startsAt).toZonedDateTimeISO(VIENNA).offset;
    const offsetAfter = Temporal.Instant.from(afterFirst.startsAt).toZonedDateTimeISO(VIENNA).offset;
    expect(offsetBefore).not.toBe(offsetAfter);
  });

  it('offers the same number of slots either side', async () => {
    // A 25-hour day does not become a longer working day.
    const { before, after } = straddleNextTransition(VIENNA);
    const body = await fetchBody(WIEN_SLUG, {
      serviceId: COLOR_SERVICE,
      from: before.toString(),
      through: after.toString(),
    });

    expect(openDay(body, before)).toHaveLength(23);
    expect(openDay(body, after)).toHaveLength(23);
  });
});

describe('GET /:slug/availability — per-staff constraints', () => {
  it('starts a day late when the stylist does, though the salon is open', async () => {
    // Marina's opens at 09:00 on Thursdays; Marina works from 12:00. The salon
    // being open is not enough.
    const thursday = nextWeekday(4, NEW_YORK);
    const body = await fetchBody(MARINA_SLUG, { serviceId: CUT_SERVICE, from: thursday.toString() });

    const slots = openDay(body, thursday);
    expect(localTime(slots[0]!.startsAt, NEW_YORK)).toBe('12:00');
    expect(slots).toHaveLength(22);
  });

  it('leaves a hole where a split shift breaks for lunch', async () => {
    // Saturday is 09:00-13:00 and 14:00-17:00. A 45-minute cut can start at
    // 12:15 (finishing at 13:00) but not at 12:30, and the afternoon resumes at
    // 14:00. Nothing in the gap is offered at all — those times are outside
    // business hours, so they are not candidates rather than refused ones.
    const saturday = nextWeekday(6, NEW_YORK);
    const body = await fetchBody(MARINA_SLUG, { serviceId: CUT_SERVICE, from: saturday.toString() });

    const times = openDay(body, saturday).map((s) => localTime(s.startsAt, NEW_YORK));
    expect(times).toContain('12:15');
    expect(times).not.toContain('12:30');
    expect(times).not.toContain('13:00');
    expect(times).toContain('14:00');
    expect(times.at(-1)).toBe('16:15');
  });
});

describe('GET /:slug/availability — what the public response must not contain', () => {
  it('omits the excluded reasons entirely', async () => {
    // The reasons carry appointment ids and the exact spans staff are busy —
    // together a readable map of the salon's schedule. They belong on the
    // owner's calendar, not here.
    const tuesday = nextWeekday(2, VIENNA);
    const body = await fetchBody(WIEN_SLUG, { serviceId: COLOR_SERVICE, from: tuesday.toString() });

    for (const d of body.days) {
      expect(d).not.toHaveProperty('excluded');
    }
    expect(JSON.stringify(body)).not.toContain('appointmentId');
  });

  it('omits resource ids but keeps staff ids', async () => {
    // A customer may pick a stylist; they do not pick a wash station, and which
    // one gets assigned is the booking endpoint's business.
    const tuesday = nextWeekday(2, VIENNA);
    const body = await fetchBody(WIEN_SLUG, { serviceId: COLOR_SERVICE, from: tuesday.toString() });

    for (const slot of openDay(body, tuesday)) {
      expect(slot).not.toHaveProperty('resourceIds');
      expect(slot.staffIds.length).toBeGreaterThan(0);
    }
  });
});

describe('GET /:slug/availability — rejected requests', () => {
  const tuesday = () => nextWeekday(2, VIENNA).toString();

  it('rejects a serviceId that is not a uuid', async () => {
    const res = await get(WIEN_SLUG, { serviceId: 'not-a-uuid', from: tuesday() });
    expect(res.status).toBe(400);
  });

  it('rejects a missing from date', async () => {
    const res = await get(WIEN_SLUG, { serviceId: COLOR_SERVICE });
    expect(res.status).toBe(400);
  });

  it('rejects an unparseable date', async () => {
    const res = await get(WIEN_SLUG, { serviceId: COLOR_SERVICE, from: '2026-13-45' });
    expect(res.status).toBe(400);
  });

  it('rejects through before from', async () => {
    const from = nextWeekday(2, VIENNA);
    const res = await get(WIEN_SLUG, {
      serviceId: COLOR_SERVICE,
      from: from.toString(),
      through: from.subtract({ days: 1 }).toString(),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a range longer than 31 days', async () => {
    const from = nextWeekday(2, VIENNA);
    const res = await get(WIEN_SLUG, {
      serviceId: COLOR_SERVICE,
      from: from.toString(),
      through: from.add({ days: 31 }).toString(), // 32 days inclusive
    });
    expect(res.status).toBe(400);
  });

  it('accepts exactly 31 days', async () => {
    const from = nextWeekday(2, VIENNA);
    const body = await fetchBody(WIEN_SLUG, {
      serviceId: COLOR_SERVICE,
      from: from.toString(),
      through: from.add({ days: 30 }).toString(),
    });
    expect(body.days).toHaveLength(31);
  });

  it('404s an unknown tenant slug', async () => {
    const res = await get('no-such-salon', { serviceId: COLOR_SERVICE, from: tuesday() });
    expect(res.status).toBe(404);
  });

  it('404s a service that does not exist', async () => {
    const res = await get(WIEN_SLUG, { serviceId: ABSENT_SERVICE, from: tuesday() });
    expect(res.status).toBe(404);
  });

  it("404s another tenant's service, identically", async () => {
    // Marina's Cut, asked for under Studio Wien's slug. RLS returns zero rows,
    // so this is indistinguishable from the test above — which is the point. A
    // 403 here would confirm the id exists somewhere.
    const absent = await get(WIEN_SLUG, { serviceId: ABSENT_SERVICE, from: tuesday() });
    const otherTenants = await get(WIEN_SLUG, { serviceId: CUT_SERVICE, from: tuesday() });

    expect(otherTenants.status).toBe(404);
    expect(otherTenants.body).toEqual(absent.body);
  });
});
