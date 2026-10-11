// Functions 8-9: gridTimes, blockedIntervalFor.
//
// Candidate start times sit on local quarter hours regardless of opening time.
// The two clock-change nights are the interesting cases, and they behave
// asymmetrically — see the comments on each.

import { describe, it, expect } from 'vitest';
import { blockedIntervalFor, gridTimes } from '../../src/availability/engine.js';
import {
  EU_FALL,
  EU_SPRING,
  VIENNA,
  interval,
  localTimes,
  minutes,
  service,
  zoned,
} from '../../src/availability/fixtures.js';

describe('gridTimes', () => {
  it('fills an ordinary day on the quarter hour', () => {
    const open = interval(zoned('2026-06-15', '09:00'), zoned('2026-06-15', '17:00'));

    const times = localTimes(gridTimes(open, VIENNA));

    expect(times).toHaveLength(32);
    expect(times[0]).toBe('09:00');
    // Strictly before the end: a booking starting at closing has nowhere to go.
    expect(times.at(-1)).toBe('16:45');
  });

  it('rounds the first time up when the business opens off-grid', () => {
    const open = interval(zoned('2026-06-15', '09:10'), zoned('2026-06-15', '17:00'));

    expect(localTimes(gridTimes(open, VIENNA))[0]).toBe('09:15');
  });

  it('offers a time that the period merely contains', () => {
    // Closing at 17:10 makes 17:00 a candidate, where closing at 17:00 does not.
    // The pair pins the boundary.
    const open = interval(zoned('2026-06-15', '09:00'), zoned('2026-06-15', '17:10'));

    expect(localTimes(gridTimes(open, VIENNA)).at(-1)).toBe('17:00');
  });

  it('returns nothing for a period shorter than the grid', () => {
    const open = interval(zoned('2026-06-15', '09:01'), zoned('2026-06-15', '09:10'));

    expect(gridTimes(open, VIENNA)).toEqual([]);
  });

  it('offers each repeated local time once on fall-back night', () => {
    // 02:00-02:59 happens twice in Vienna on the 25th. Only the first pass is
    // offered, so every time a customer sees means one moment.
    //
    // Note this needs explicit handling: walking a zoned time forward by 15
    // minutes of real time goes 02:45 CEST -> 02:00 CET, so the hour comes
    // round a second time unless the walk drops wall clocks it has seen.
    const night = interval(zoned(EU_FALL, '00:00'), zoned(EU_FALL, '06:00'));

    const times = localTimes(gridTimes(night, VIENNA));

    expect(times.filter((t) => t.startsWith('02:'))).toEqual(['02:00', '02:15', '02:30', '02:45']);
    expect(new Set(times).size).toBe(times.length);
    // Seven hours of real time, but only 24 offerable times — the lost hour.
    expect(times).toHaveLength(24);
  });

  it('skips the hour that does not exist on spring-forward night', () => {
    // The opposite case, and it needs no handling at all: walking real time from
    // 01:45 CET lands on 03:00 CEST, so the missing hour is never constructed.
    // What must NOT happen is 02:15 sliding to 03:15 and duplicating the real
    // 03:15, which is what naive conversion of each local time would do.
    const night = interval(zoned(EU_SPRING, '00:00'), zoned(EU_SPRING, '06:00'));

    const times = localTimes(gridTimes(night, VIENNA));

    expect(times.filter((t) => t.startsWith('02:'))).toEqual([]);
    expect(times.filter((t) => t === '03:00')).toHaveLength(1);
    expect(times).toHaveLength(20);
  });

  it('never drifts off the quarter hour, on any day', () => {
    // One sweeping check, because drift is the failure mode that per-case
    // assertions miss. Adding 15 minutes to a moment rather than to a zoned
    // time would start producing :07 and :22 after a transition.
    const days = ['2026-06-15', EU_FALL, EU_SPRING];

    for (const day of days) {
      const open = interval(zoned(day, '00:00'), zoned(day, '23:45'));
      for (const moment of gridTimes(open, VIENNA)) {
        expect(moment.toZonedDateTimeISO(VIENNA).minute % 15).toBe(0);
      }
    }
  });
});

describe('blockedIntervalFor', () => {
  it('makes the blocked span identical to the service span when there are no buffers', () => {
    const start = zoned('2026-06-15', '10:00');

    const spans = blockedIntervalFor(start, service({ duration: minutes(60) }));

    expect(spans.service).toEqual(interval(start, zoned('2026-06-15', '11:00')));
    expect(spans.blocked).toEqual(spans.service);
  });

  it('widens the blocked span by each buffer independently', () => {
    const start = zoned('2026-06-15', '10:00');

    const spans = blockedIntervalFor(
      start,
      service({ duration: minutes(60), beforeBuffer: minutes(10), afterBuffer: minutes(5) }),
    );

    expect(spans.service).toEqual(interval(start, zoned('2026-06-15', '11:00')));
    expect(spans.blocked).toEqual(
      interval(zoned('2026-06-15', '09:50'), zoned('2026-06-15', '11:05')),
    );
  });

  it('measures a service in real time across a clock change', () => {
    // A haircut does not take 120 minutes because the clocks went back. The
    // service starts at 01:30 and ends at 02:30 on the first pass through the
    // repeated hour — 60 real minutes either way.
    const start = zoned(EU_FALL, '01:30');

    const spans = blockedIntervalFor(start, service({ duration: minutes(60) }));

    expect(spans.service.endsAt.since(start).total('minutes')).toBe(60);
    expect(localTimes([spans.service.endsAt])).toEqual(['02:30']);
  });
});
