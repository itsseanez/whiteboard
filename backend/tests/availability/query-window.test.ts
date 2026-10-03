import { describe, it, expect } from 'vitest';
import { computeQueryWindow } from '../../src/availability/query-window.js';

const HOUR = 60 * 60 * 1000;

function spanHours(window: { windowStart: Date; windowEnd: Date }): number {
  return (window.windowEnd.getTime() - window.windowStart.getTime()) / HOUR;
}

// Reference points, so the expected values below are checkable rather than magic:
//   EU shifts on the LAST Sunday of March and October  → 2026-03-29, 2026-10-25
//   US shifts on the SECOND Sunday of March and the FIRST Sunday of November
//                                                      → 2026-03-08, 2026-11-01
// Both transition dates are Sundays, every year, in both regions.

describe('computeQueryWindow', () => {
  it('brackets an ordinary Vienna day, widened at both ends', () => {
    // 29 October is after the EU switch, so Vienna is on CET (+01:00).
    // Start of day is 23:00Z the previous evening; the 60-minute widening
    // pushes each bound one hour further out, so the span is 24 + 2 hours.
    const window = computeQueryWindow('Europe/Vienna', '2026-10-29', '2026-10-29', 60);

    expect(window.windowStart.toISOString()).toBe('2026-10-28T22:00:00.000Z');
    expect(window.windowEnd.toISOString()).toBe('2026-10-30T00:00:00.000Z');
    expect(spanHours(window)).toBe(26);
  });

  it('covers 25 hours on the Vienna fall-back day', () => {
    // 25 October begins on CEST (+02:00) — the switch happens at 03:00 local,
    // partway through the day — and 26 October begins on CET (+01:00).
    // Position is asserted as well as length: a bug that shifted both bounds
    // equally would still produce 25 hours.
    const window = computeQueryWindow('Europe/Vienna', '2026-10-25', '2026-10-25', 0);

    expect(window.windowStart.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(spanHours(window)).toBe(25);
  });

  it('covers 23 hours on the Vienna spring-forward day', () => {
    // 29 March begins on CET (+01:00); 30 March begins on CEST (+02:00).
    const window = computeQueryWindow('Europe/Vienna', '2026-03-29', '2026-03-29', 0);

    expect(window.windowStart.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(spanHours(window)).toBe(23);
  });

  it('tracks a gap between tenants that changes across the year', () => {
    // The scope doc's claim: Europe and North America shift on different dates,
    // so the offset between two tenants is NOT constant.
    //
    // July   — Vienna CEST (+02:00), Atlanta EDT (−04:00) → 6 hours apart
    // 29 Oct — Vienna CET  (+01:00), Atlanta EDT (−04:00) → 5 hours apart
    //          (the US does not switch until 1 November)
    //
    // Only correct expansion in both zones produces different gaps; a naive
    // fixed-offset implementation gives the same number twice.
    const summerVienna = computeQueryWindow('Europe/Vienna', '2026-07-15', '2026-07-15', 0);
    const summerAtlanta = computeQueryWindow('America/New_York', '2026-07-15', '2026-07-15', 0);
    const autumnVienna = computeQueryWindow('Europe/Vienna', '2026-10-29', '2026-10-29', 0);
    const autumnAtlanta = computeQueryWindow('America/New_York', '2026-10-29', '2026-10-29', 0);

    const summerGap =
      (summerAtlanta.windowStart.getTime() - summerVienna.windowStart.getTime()) / HOUR;
    const autumnGap =
      (autumnAtlanta.windowStart.getTime() - autumnVienna.windowStart.getTime()) / HOUR;

    expect(summerGap).toBe(6);
    expect(autumnGap).toBe(5);
    expect(autumnGap).not.toBe(summerGap);
  });

  it('covers one whole day in UTC when both dates are the same', () => {
    // The off-by-one guard: without advancing the end date by a calendar day,
    // a single-date request collapses to a zero-length window and every slot
    // silently disappears.
    const window = computeQueryWindow('UTC', '2026-10-29', '2026-10-29', 0);

    expect(window.windowStart.toISOString()).toBe('2026-10-29T00:00:00.000Z');
    expect(window.windowEnd.toISOString()).toBe('2026-10-30T00:00:00.000Z');
    expect(spanHours(window)).toBe(24);
  });

  it('treats throughDate as inclusive across a multi-day range', () => {
    // 29, 30 and 31 October — three whole days, all on CET, so 72 hours.
    // An exclusive end date would yield 48.
    const window = computeQueryWindow('Europe/Vienna', '2026-10-29', '2026-10-31', 0);

    expect(window.windowStart.toISOString()).toBe('2026-10-28T23:00:00.000Z');
    expect(window.windowEnd.toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(spanHours(window)).toBe(72);
  });
});
