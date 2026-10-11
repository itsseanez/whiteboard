// Functions 11-12: computeDay and computeAvailability, end to end.
//
// The file that holds the phase gate: correct slots across a DST boundary.

import { describe, it, expect } from 'vitest';
import { computeAvailability, isStaffReasons } from '../../src/availability/engine.js';
import type { AvailabilityDay } from '../../src/availability/types.js';
import {
  EU_FALL,
  NEW_YORK,
  US_FALL,
  UTC,
  VIENNA,
  busy,
  date,
  everyDay,
  input,
  instant,
  interval,
  localTimes,
  minutes,
  resource,
  rule,
  staff,
  weekdaysOnly,
  zoned,
} from '../../src/availability/fixtures.js';

/** Fails loudly instead of returning undefined slots on a closed day. */
function openDay(day: AvailabilityDay | undefined) {
  if (!day || day.status !== 'open') throw new Error(`expected an open day, got ${day?.status}`);
  return day;
}

describe('computeAvailability — the shape of the answer', () => {
  it('returns one day per requested date, inclusive', () => {
    const result = computeAvailability(
      input({ fromDate: '2026-06-15', throughDate: '2026-06-17' }),
    );

    expect(result.days.map((d) => d.date)).toEqual([
      date('2026-06-15'),
      date('2026-06-16'),
      date('2026-06-17'),
    ]);
  });

  it('returns a single day when both dates are the same', () => {
    const result = computeAvailability(input({ fromDate: '2026-06-15' }));

    expect(result.days).toHaveLength(1);
  });

  it('marks closed days closed, with no slots or excluded at all', () => {
    // 2026-06-20 is a Saturday.
    const result = computeAvailability(
      input({
        fromDate: '2026-06-19',
        throughDate: '2026-06-21',
        businessHours: weekdaysOnly('09:00', '17:00'),
      }),
    );

    expect(result.days.map((d) => d.status)).toEqual(['open', 'closed', 'closed']);
    // Absent, not empty. An empty slot list would read as "open but nothing free".
    expect(result.days[1]).toEqual({ date: date('2026-06-20'), status: 'closed' });
  });

  it('accounts for every candidate time exactly once', () => {
    const day = openDay(computeAvailability(input()).days[0]);

    const starts = [...day.slots.map((s) => s.startsAt), ...day.excluded.map((e) => e.startsAt)];
    expect(starts).toHaveLength(32); // 09:00..16:45
    expect(new Set(localTimes(starts)).size).toBe(32);
  });

  it('returns slots in ascending order', () => {
    const day = openDay(computeAvailability(input()).days[0]);

    const times = localTimes(day.slots.map((s) => s.startsAt));
    expect([...times].sort()).toEqual(times);
  });

  it('offers nothing in the gap of a split shift, not even an excluded entry', () => {
    // `excluded` means "inside business hours but unbookable". Lunch is outside
    // business hours, so those times are not candidates at all.
    const day = openDay(
      computeAvailability(
        input({ businessHours: [rule(1, '09:00', '12:00'), rule(1, '13:00', '17:00')] }),
      ).days[0],
    );

    const all = localTimes([
      ...day.slots.map((s) => s.startsAt),
      ...day.excluded.map((e) => e.startsAt),
    ]);
    expect(all.filter((t) => t >= '12:00' && t < '13:00')).toEqual([]);
    expect(all).toContain('11:45');
    expect(all).toContain('13:00');
  });
});

describe('computeAvailability — no qualified staff', () => {
  it('flags it but still returns the calendar', () => {
    const result = computeAvailability(
      input({ fromDate: '2026-06-15', throughDate: '2026-06-17', staffCandidates: [] }),
    );

    expect(result.noQualifiedStaff).toBe(true);
    // The front end still needs real dates to draw a skeleton under its message.
    expect(result.days).toHaveLength(3);
    expect(result.days.every((d) => d.status === 'closed')).toBe(true);
  });

  it('is a different fact from a stylist with no shifts recorded', () => {
    const result = computeAvailability(
      input({ staffCandidates: [staff('s1', { workingHours: [] })] }),
    );

    expect(result.noQualifiedStaff).toBe(false);
    const day = openDay(result.days[0]);
    expect(day.slots).toEqual([]);
    // Every candidate time refused for the same per-staff reason — except the
    // last few, which the business-wide closing check catches first.
    const staffReasons = day.excluded.filter((e) => isStaffReasons(e.reason));
    expect(staffReasons).toHaveLength(29);
    expect(
      staffReasons.every((e) => isStaffReasons(e.reason) && e.reason[0]?.reason === 'outsideWorkingHours'),
    ).toBe(true);
  });
});

describe('computeAvailability — the DST gate', () => {
  it('gives every day the same local times across the Vienna fall-back day', () => {
    const result = computeAvailability(
      input({ fromDate: '2026-10-24', throughDate: '2026-10-26' }),
    );

    const days = result.days.map(openDay);
    const firstTimes = days.map((d) => localTimes(d.slots.map((s) => s.startsAt))[0]);
    const lastTimes = days.map((d) => localTimes(d.slots.map((s) => s.startsAt)).at(-1));

    // The middle day is the clock-change date — that is the point of the range.
    expect(days[1]?.date).toEqual(date(EU_FALL));
    expect(days.map((d) => d.slots.length)).toEqual([29, 29, 29]);
    expect(firstTimes).toEqual(['09:00', '09:00', '09:00']);
    expect(lastTimes).toEqual(['16:00', '16:00', '16:00']);
  });

  it('puts the extra hour where it actually falls', () => {
    // The assertion that catches a reused offset. The transition is at 03:00,
    // INSIDE the 25th but before opening, so the extra hour stretches the gap
    // from the 24th's nine o'clock to the 25th's — not the gap after it.
    //
    //   24th 09:00 = 07:00Z (+02:00)
    //   25th 09:00 = 08:00Z (+01:00)  -> 25 hours later
    //   26th 09:00 = 08:00Z (+01:00)  -> 24 hours later
    //
    // Asserting only the local times above would pass on code that computed
    // every day with the same offset; asserting only the moments would pass on
    // code that drifted the wall clock. Both together will not.
    const result = computeAvailability(
      input({ fromDate: '2026-10-24', throughDate: '2026-10-26' }),
    );

    const nines = result.days.map(openDay).map((d) => d.slots[0]?.startsAt);
    expect(nines).toEqual([
      instant('2026-10-24T07:00:00Z'),
      instant('2026-10-25T08:00:00Z'),
      instant('2026-10-26T08:00:00Z'),
    ]);
    expect(nines[1]?.since(nines[0]!).total('hours')).toBe(25);
    expect(nines[2]?.since(nines[1]!).total('hours')).toBe(24);
  });

  it('keeps every service exactly as long as the service is', () => {
    const result = computeAvailability(
      input({ fromDate: '2026-10-24', throughDate: '2026-10-26' }),
    );

    for (const day of result.days.map(openDay)) {
      for (const slot of day.slots) {
        expect(slot.endsAt.since(slot.startsAt).total('minutes')).toBe(60);
      }
    }
  });

  it('does the same thing in New York, which shifts on a different date', () => {
    // The US changes on the first Sunday of November, five weeks after the EU.
    // The same code has to be right in both, with no per-region branching.
    const result = computeAvailability(
      input({
        timeZone: NEW_YORK,
        fromDate: '2026-10-31',
        throughDate: '2026-11-02',
        now: instant('2026-01-01T00:00:00Z'),
      }),
    );

    const days = result.days.map(openDay);
    expect(days[1]?.date).toEqual(date(US_FALL));
    expect(days.map((d) => d.slots.length)).toEqual([29, 29, 29]);
    expect(days.map((d) => localTimes(d.slots.map((s) => s.startsAt), NEW_YORK)[0])).toEqual([
      '09:00',
      '09:00',
      '09:00',
    ]);

    const nines = days.map((d) => d.slots[0]?.startsAt);
    // 31 Oct is EDT (-04:00), 1 Nov crosses at 02:00 so nine o'clock is EST
    // (-05:00), and 2 Nov is EST throughout.
    expect(nines[1]?.since(nines[0]!).total('hours')).toBe(25);
    expect(nines[2]?.since(nines[1]!).total('hours')).toBe(24);
  });

  it('behaves identically in a zone that never shifts', () => {
    // The control. If this disagrees with the Vienna case on anything but the
    // instants, the bug is not about time zones.
    const result = computeAvailability(
      input({ timeZone: UTC, fromDate: '2026-10-24', throughDate: '2026-10-26' }),
    );

    const days = result.days.map(openDay);
    expect(days.map((d) => d.slots.length)).toEqual([29, 29, 29]);
    const nines = days.map((d) => d.slots[0]?.startsAt);
    expect(nines[1]?.since(nines[0]!).total('hours')).toBe(24);
    expect(nines[2]?.since(nines[1]!).total('hours')).toBe(24);
  });
});

describe('computeAvailability — overnight hours', () => {
  it('files each candidate under the date it starts on', () => {
    // A bar open 18:00-02:00, stored as two rows. Saturday's list runs from
    // 18:00 to 23:45 plus Friday night's spillover from 00:00 to 01:45 — all
    // times whose local date is Saturday, and nothing belonging to Sunday.
    const result = computeAvailability(
      input({
        fromDate: '2026-06-20',
        businessHours: [...everyDay('18:00', '00:00'), ...everyDay('00:00', '02:00')],
        staffCandidates: [
          staff('s1', {
            workingHours: [...everyDay('18:00', '00:00'), ...everyDay('00:00', '02:00')],
          }),
        ],
        service: { duration: minutes(60) },
      }),
    );

    const day = openDay(result.days[0]);
    const starts = [...day.slots.map((s) => s.startsAt), ...day.excluded.map((e) => e.startsAt)];
    const dates = new Set(starts.map((i) => i.toZonedDateTimeISO(VIENNA).toPlainDate().toString()));

    expect(dates).toEqual(new Set(['2026-06-20']));
  });

  it('lets a service run past midnight', () => {
    // 23:30 plus 60 minutes finishes at 00:30 the next day, which is fine: the
    // business is open until 02:00. Only the START has to fall inside the date.
    const overnight = [...everyDay('18:00', '00:00'), ...everyDay('00:00', '02:00')];
    const result = computeAvailability(
      input({
        fromDate: '2026-06-20',
        businessHours: overnight,
        staffCandidates: [staff('s1', { workingHours: overnight })],
      }),
    );

    const day = openDay(result.days[0]);
    const lateSlot = day.slots.find((s) => localTimes([s.startsAt])[0] === '23:30');
    expect(lateSlot?.endsAt).toEqual(zoned('2026-06-21', '00:30'));
  });
});

describe('computeAvailability — constraints in combination', () => {
  it('excludes everything before now plus the minimum notice', () => {
    const result = computeAvailability(
      input({
        fromDate: '2026-06-15',
        now: zoned('2026-06-15', '09:00'),
        service: { duration: minutes(60), minimumNotice: minutes(120) },
      }),
    );

    const day = openDay(result.days[0]);
    expect(localTimes(day.slots.map((s) => s.startsAt))[0]).toBe('11:00');
    expect(
      day.excluded.filter((e) => !isStaffReasons(e.reason) && e.reason.reason === 'tooSoon'),
    ).toHaveLength(8); // 09:00 through 10:45
  });

  it('keeps a stylist bookable around their own appointments', () => {
    const result = computeAvailability(
      input({
        staffCandidates: [
          staff('s1', {
            busyIntervals: [busy('a1', zoned('2026-06-15', '11:00'), zoned('2026-06-15', '12:00'))],
          }),
        ],
      }),
    );

    const times = localTimes(openDay(result.days[0]).slots.map((s) => s.startsAt));
    // A 60-minute service can't start 10:15 through 11:45 without hitting it.
    expect(times).toContain('10:00');
    expect(times).not.toContain('10:15');
    expect(times).not.toContain('11:45');
    expect(times).toContain('12:00');
  });

  it('respects time off across a whole day', () => {
    const result = computeAvailability(
      input({
        fromDate: '2026-06-15',
        throughDate: '2026-06-16',
        staffCandidates: [
          staff('s1', {
            timeOff: [interval(zoned('2026-06-15', '00:00'), zoned('2026-06-16', '00:00'))],
          }),
        ],
      }),
    );

    expect(openDay(result.days[0]).slots).toEqual([]);
    expect(openDay(result.days[1]).slots.length).toBeGreaterThan(0);
  });

  it('falls back to a second resource when the first is taken', () => {
    const result = computeAvailability(
      input({
        resourceCandidates: [
          resource('r1', [busy('a1', zoned('2026-06-15', '09:00'), zoned('2026-06-15', '17:00'))]),
          resource('r2'),
        ],
      }),
    );

    const day = openDay(result.days[0]);
    expect(day.slots.length).toBe(29);
    expect(day.slots.every((s) => s.resourceIds.length === 1 && s.resourceIds[0] === 'r2')).toBe(
      true,
    );
  });

  it('closes the day for the service when every resource is taken all day', () => {
    const allDay = busy('a1', zoned('2026-06-15', '09:00'), zoned('2026-06-15', '17:00'));
    const result = computeAvailability(
      input({ resourceCandidates: [resource('r1', [allDay]), resource('r2', [allDay])] }),
    );

    const day = openDay(result.days[0]);
    expect(day.slots).toEqual([]);
    expect(
      day.excluded.filter(
        (e) => !isStaffReasons(e.reason) && e.reason.reason === 'noAvailableResource',
      ),
    ).toHaveLength(29);
  });
});
