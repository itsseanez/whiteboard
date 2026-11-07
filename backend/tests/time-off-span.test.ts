// backend/tests/time-off-span.test.ts
//
// Wall-clock time off to instants, including both DST transitions. No
// database: the conversion is a pure function of the input and the zone.

import { describe, expect, it } from 'vitest';
import { parseTimeOff, timeOffSpan, type TimeOffInput } from '../src/lib/time-off-span.js';

const VIENNA = 'Europe/Vienna';
const NEW_YORK = 'America/New_York';

function span(input: TimeOffInput, zone: string) {
  const result = timeOffSpan(input, zone);
  if (!result.ok) throw new Error(result.error);
  return { startsAt: result.value.startsAt.toString(), endsAt: result.value.endsAt.toString() };
}

describe('timeOffSpan', () => {
  it('reads whole days from the start of the first to the start of the day after the last', () => {
    expect(span({ startDate: '2026-12-24', endDate: '2026-12-26' }, VIENNA)).toEqual({
      startsAt: '2026-12-23T23:00:00Z',
      endsAt: '2026-12-26T23:00:00Z',
    });
  });

  it("uses the organization's zone, not a fixed offset", () => {
    // The same wall times, six hours apart in UTC.
    expect(span({ startDate: '2026-12-24', startTime: '09:00', endDate: '2026-12-24', endTime: '12:00' }, VIENNA)).toEqual({
      startsAt: '2026-12-24T08:00:00Z',
      endsAt: '2026-12-24T11:00:00Z',
    });
    expect(span({ startDate: '2026-12-24', startTime: '09:00', endDate: '2026-12-24', endTime: '12:00' }, NEW_YORK)).toEqual({
      startsAt: '2026-12-24T14:00:00Z',
      endsAt: '2026-12-24T17:00:00Z',
    });
  });

  it('lets one end have a time and the other not', () => {
    expect(span({ startDate: '2026-12-24', startTime: '14:00', endDate: '2026-12-26' }, VIENNA)).toEqual({
      startsAt: '2026-12-24T13:00:00Z',
      endsAt: '2026-12-26T23:00:00Z',
    });
  });

  it('keeps 9:00 at 9:00 across a DST change inside the range', () => {
    // Vienna leaves summer time on 25 October 2026: +02:00 before, +01:00 after.
    expect(span({ startDate: '2026-10-23', startTime: '09:00', endDate: '2026-10-27', endTime: '09:00' }, VIENNA)).toEqual({
      startsAt: '2026-10-23T07:00:00Z',
      endsAt: '2026-10-27T08:00:00Z',
    });
  });

  it('counts a whole day on a short or long DST day as that day, 23 or 25 hours', () => {
    const spring = timeOffSpan({ startDate: '2026-03-29', endDate: '2026-03-29' }, VIENNA);
    const autumn = timeOffSpan({ startDate: '2026-10-25', endDate: '2026-10-25' }, VIENNA);
    if (!spring.ok || !autumn.ok) throw new Error('expected spans');
    expect(spring.value.startsAt.until(spring.value.endsAt).total('hours')).toBe(23);
    expect(autumn.value.startsAt.until(autumn.value.endsAt).total('hours')).toBe(25);
  });

  it('moves a start that does not exist (spring forward) to just after the gap', () => {
    // 02:30 never happens in Vienna on 29 March 2026; clocks go 02:00 → 03:00.
    expect(span({ startDate: '2026-03-29', startTime: '02:30', endDate: '2026-03-29', endTime: '05:00' }, VIENNA).startsAt).toBe(
      '2026-03-29T01:30:00Z', // 03:30 summer time
    );
  });

  it('takes the second occurrence of an ambiguous end (fall back), the longer absence', () => {
    // 02:30 happens twice in Vienna on 25 October 2026: first +02:00, then +01:00.
    expect(span({ startDate: '2026-10-25', startTime: '00:00', endDate: '2026-10-25', endTime: '02:30' }, VIENNA).endsAt).toBe(
      '2026-10-25T01:30:00Z',
    );
  });

  it('refuses a range that ends before or as it starts', () => {
    expect(timeOffSpan({ startDate: '2026-12-24', startTime: '12:00', endDate: '2026-12-24', endTime: '09:00' }, VIENNA).ok).toBe(false);
    expect(timeOffSpan({ startDate: '2026-12-26', endDate: '2026-12-24' }, VIENNA).ok).toBe(false);
    expect(timeOffSpan({ startDate: '2026-12-24', startTime: '09:00', endDate: '2026-12-24', endTime: '09:00' }, VIENNA).ok).toBe(false);
  });

  it('refuses more than a year at once', () => {
    expect(timeOffSpan({ startDate: '2026-01-01', endDate: '2027-01-02' }, VIENNA).ok).toBe(false);
  });
});

describe('parseTimeOff', () => {
  it('defaults the end date to the start date', () => {
    expect(parseTimeOff({ startDate: '2026-12-24' })).toEqual({
      ok: true,
      value: { startDate: '2026-12-24', endDate: '2026-12-24', startTime: undefined, endTime: undefined, reason: undefined },
    });
  });

  it('treats empty strings as absent, as a form sends them', () => {
    const parsed = parseTimeOff({ startDate: '2026-12-24', endDate: '', startTime: '', endTime: '', reason: '  ' });
    expect(parsed.ok && parsed.value.startTime).toBeUndefined();
    expect(parsed.ok && parsed.value.reason).toBeUndefined();
  });

  it('rejects impossible dates and malformed times', () => {
    expect(parseTimeOff({ startDate: '2026-02-30' }).ok).toBe(false);
    expect(parseTimeOff({ startDate: '24.12.2026' }).ok).toBe(false);
    expect(parseTimeOff({ startDate: '2026-12-24', startTime: '9:00' }).ok).toBe(false);
    expect(parseTimeOff({ startDate: '2026-12-24', endTime: '24:00' }).ok).toBe(false);
  });
});
