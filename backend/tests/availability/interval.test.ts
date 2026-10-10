// Functions 1-4 of the engine: overlaps, intersect, subtract, mergeTouching.
// No time zones involved — these compare absolute moments, so everything here
// is built from UTC instants on one arbitrary day.
//
// Temporal.Duration is compared by toString(), NOT by total elapsed time. So
// Duration.from({ minutes: 60 }) and Duration.from({ hours: 1 }) are NOT equal
// under toEqual — "PT60M" vs "PT1H". Build durations the same way everywhere,
// or compare .total('minutes').

import { describe, it, expect } from 'vitest';
import { intersect, mergeTouching, overlaps, subtract } from '../../src/availability/engine.js';
import type { Interval } from '../../src/availability/types.js';

const DAY = '2026-06-15'; // a Monday, nowhere near a clock change

function at(time: string, date: string = DAY): Temporal.Instant {
  return Temporal.Instant.from(`${date}T${time}:00Z`);
}

function iv(start: string, end: string): Interval {
  return { startsAt: at(start), endsAt: at(end) };
}

// ---------------------------------------------------------------------------

describe('overlaps', () => {
  it('is false for spans that do not touch, in either order', () => {
    const morning = iv('09:00', '10:00');
    const afternoon = iv('14:00', '15:00');

    expect(overlaps(morning, afternoon)).toBe(false);
    expect(overlaps(afternoon, morning)).toBe(false);
  });

  it('is false when one ends exactly where the other begins', () => {
    // The half-open rule: the 10:00 appointment owns 10:00, the 09:00 one has
    // finished. Without this, back-to-back bookings look double-booked.
    const first = iv('09:00', '10:00');
    const second = iv('10:00', '11:00');

    expect(overlaps(first, second)).toBe(false);
    expect(overlaps(second, first)).toBe(false);
  });

  it('is true for a partial overlap, in either order', () => {
    const a = iv('09:00', '10:00');
    const b = iv('09:30', '10:30');

    expect(overlaps(a, b)).toBe(true);
    expect(overlaps(b, a)).toBe(true);
  });

  it('is true when one span contains the other, in either order', () => {
    const outer = iv('09:00', '17:00');
    const inner = iv('12:00', '13:00');

    expect(overlaps(outer, inner)).toBe(true);
    expect(overlaps(inner, outer)).toBe(true);
  });

  it('is true for two identical spans', () => {
    expect(overlaps(iv('09:00', '10:00'), iv('09:00', '10:00'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('intersect', () => {
  it('returns the shared middle of a partial overlap, in either order', () => {
    const a = iv('09:00', '10:00');
    const b = iv('09:30', '10:30');

    expect(intersect(a, b)).toEqual(iv('09:30', '10:00'));
    expect(intersect(b, a)).toEqual(iv('09:30', '10:00'));
  });

  it('returns the inner span when one contains the other', () => {
    const outer = iv('09:00', '17:00');
    const inner = iv('12:00', '13:00');

    expect(intersect(outer, inner)).toEqual(inner);
    expect(intersect(inner, outer)).toEqual(inner);
  });

  it('returns the span itself when both are identical', () => {
    expect(intersect(iv('09:00', '10:00'), iv('09:00', '10:00'))).toEqual(iv('09:00', '10:00'));
  });

  it('returns null when the spans only touch', () => {
    // Not a zero-length interval. A zero-length result could be passed on and
    // treated as real time; null cannot.
    expect(intersect(iv('09:00', '10:00'), iv('10:00', '11:00'))).toBeNull();
  });

  it('returns null for spans that do not touch', () => {
    expect(intersect(iv('09:00', '10:00'), iv('14:00', '15:00'))).toBeNull();
  });

  it('expresses containment: A is inside B when the intersection equals A', () => {
    // How evaluateGridTime asks "does the service fit before closing", before
    // `contains` exists.
    const businessHours = iv('09:00', '17:00');
    const fits = iv('14:00', '15:00');
    const runsPastClosing = iv('16:30', '17:30');

    expect(intersect(businessHours, fits)).toEqual(fits);
    expect(intersect(businessHours, runsPastClosing)).toEqual(iv('16:30', '17:00'));
  });
});

// ---------------------------------------------------------------------------

describe('subtract', () => {
  it('returns nothing when the cut covers the whole span', () => {
    expect(subtract(iv('09:00', '10:00'), iv('08:00', '11:00'))).toEqual([]);
  });

  it('returns nothing when the cut matches the span exactly', () => {
    expect(subtract(iv('09:00', '10:00'), iv('09:00', '10:00'))).toEqual([]);
  });

  it('clips the front', () => {
    expect(subtract(iv('09:00', '17:00'), iv('08:00', '12:00'))).toEqual([iv('12:00', '17:00')]);
  });

  it('clips the back', () => {
    expect(subtract(iv('09:00', '17:00'), iv('15:00', '18:00'))).toEqual([iv('09:00', '15:00')]);
  });

  it('splits into two when the cut lands in the middle', () => {
    // The case that gets forgotten. An implementation returning a single
    // interval passes every test above and silently erases an afternoon.
    expect(subtract(iv('09:00', '17:00'), iv('12:00', '13:00'))).toEqual([
      iv('09:00', '12:00'),
      iv('13:00', '17:00'),
    ]);
  });

  it('returns the span unchanged when the cut is elsewhere', () => {
    expect(subtract(iv('09:00', '17:00'), iv('18:00', '19:00'))).toEqual([iv('09:00', '17:00')]);
  });

  it('returns the span unchanged when the cut only touches either edge', () => {
    // Touching is not overlapping, so there is nothing to remove.
    expect(subtract(iv('09:00', '17:00'), iv('08:00', '09:00'))).toEqual([iv('09:00', '17:00')]);
    expect(subtract(iv('09:00', '17:00'), iv('17:00', '18:00'))).toEqual([iv('09:00', '17:00')]);
  });
});

// ---------------------------------------------------------------------------

describe('mergeTouching', () => {
  it('returns nothing for an empty list', () => {
    expect(mergeTouching([])).toEqual([]);
  });

  it('returns a single span unchanged', () => {
    expect(mergeTouching([iv('09:00', '17:00')])).toEqual([iv('09:00', '17:00')]);
  });

  it('leaves genuinely separate spans alone', () => {
    // A split shift with a real lunch gap.
    expect(mergeTouching([iv('09:00', '12:00'), iv('13:00', '17:00')])).toEqual([
      iv('09:00', '12:00'),
      iv('13:00', '17:00'),
    ]);
  });

  it('sorts unsorted input', () => {
    expect(
      mergeTouching([iv('15:00', '16:00'), iv('09:00', '10:00'), iv('12:00', '13:00')]),
    ).toEqual([iv('09:00', '10:00'), iv('12:00', '13:00'), iv('15:00', '16:00')]);
  });

  it('glues two overlapping spans', () => {
    // Two overlapping hours rows the owner UI allowed.
    expect(mergeTouching([iv('09:00', '13:00'), iv('11:00', '17:00')])).toEqual([
      iv('09:00', '17:00'),
    ]);
  });

  it('glues two spans that only touch', () => {
    // Touching merges here even though it is not a collision in `overlaps`.
    expect(mergeTouching([iv('09:00', '13:00'), iv('13:00', '17:00')])).toEqual([
      iv('09:00', '17:00'),
    ]);
  });

  it('glues a chain where each span touches the next', () => {
    expect(
      mergeTouching([iv('09:00', '11:00'), iv('11:00', '13:00'), iv('13:00', '15:00')]),
    ).toEqual([iv('09:00', '15:00')]);
  });

  it('keeps the long span when a short one sits entirely inside it', () => {
    // The classic bug: folding by always extending the end to `next.end`
    // shrinks 09:00-17:00 down to 09:00-13:00 here.
    expect(mergeTouching([iv('09:00', '17:00'), iv('12:00', '13:00')])).toEqual([
      iv('09:00', '17:00'),
    ]);
  });

  it('merges some and leaves others, in one pass', () => {
    expect(
      mergeTouching([iv('09:00', '11:00'), iv('10:30', '12:00'), iv('15:00', '16:00')]),
    ).toEqual([iv('09:00', '12:00'), iv('15:00', '16:00')]);
  });

  it('glues an overnight pair split at midnight', () => {
    // The reason the function exists. A bar open 18:00-02:00 is stored as two
    // rows, because one row cannot hold an end earlier than its start. Once
    // expanded they touch at midnight and must come out as one stretch, or no
    // service can be booked across it.
    const evening: Interval = { startsAt: at('18:00'), endsAt: at('00:00', '2026-06-16') };
    const earlyHours: Interval = {
      startsAt: at('00:00', '2026-06-16'),
      endsAt: at('02:00', '2026-06-16'),
    };

    expect(mergeTouching([evening, earlyHours])).toEqual([
      { startsAt: at('18:00'), endsAt: at('02:00', '2026-06-16') },
    ]);
  });

  it('does not mutate the array it is given', () => {
    // The parameter is readonly, so `.sort()` will not compile — but a cast or
    // a copy-by-reference slip would reorder the caller's data, and the damage
    // would show up somewhere else entirely.
    const input = [iv('15:00', '16:00'), iv('09:00', '10:00')];

    mergeTouching(input);

    expect(input).toEqual([iv('15:00', '16:00'), iv('09:00', '10:00')]);
  });
});
