// Tests for the month and week grid arithmetic.
//
// Two things here are worth more than the rest.
//
// The first is the 31-day cap. The availability endpoint refuses an inclusive
// range longer than 31 days, so rangeFor('month', …) returning 32 is a 400 in
// production, on exactly one month of the year, discovered by a customer. It
// is asserted across every month of several years rather than on one example.
//
// The second is that none of this may depend on the machine's time zone. The
// file's whole premise is that once you have a date string the arithmetic is
// pure calendar maths, and the bug it exists to prevent — building grids from
// local-time Dates — is invisible in Vienna and wrong in Georgia. Node honours
// a mid-process change to process.env.TZ, so that claim is tested rather than
// asserted in a comment.

import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  addMonths,
  endOfMonth,
  monthGrid,
  rangeFor,
  sameMonth,
  startOfMonth,
  startOfWeek,
  weekDates,
  weekdayIndex,
} from './calendar';

/** Inclusive day count, the way the endpoint counts it. */
function inclusiveDays(from: string, through: string): number {
  return (Date.parse(`${through}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

describe('addDays', () => {
  it('moves within a month', () => {
    expect(addDays('2026-10-12', 3)).toBe('2026-10-15');
    expect(addDays('2026-10-12', -3)).toBe('2026-10-09');
  });

  it('crosses a month boundary', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('knows which Februaries have 29 days', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    // 2100 is divisible by 4 but not a leap year.
    expect(addDays('2100-02-28', 1)).toBe('2100-03-01');
  });
});

describe('addMonths', () => {
  it('keeps the day of month when it exists', () => {
    expect(addMonths('2026-10-12', 1)).toBe('2026-11-12');
    expect(addMonths('2026-10-12', -1)).toBe('2026-09-12');
  });

  it('clamps rather than overflowing into the next month', () => {
    // Date's own setMonth rolls over: 31 January plus a month would be
    // 3 March. Stepping a calendar forward must never skip February.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-05-31', 1)).toBe('2026-06-30');
  });

  it('rolls the year in both directions', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-06-15', 12)).toBe('2027-06-15');
    expect(addMonths('2026-06-15', -18)).toBe('2024-12-15');
  });

  it('is a no-op at zero', () => {
    expect(addMonths('2026-10-12', 0)).toBe('2026-10-12');
  });

  it('never produces an invalid date, stepped across four years', () => {
    // Walking a month at a time from the 31st is where clamping gets tested
    // for real: every short month has to catch it.
    let date = '2026-01-31';
    for (let i = 0; i < 48; i += 1) {
      date = addMonths(date, 1);
      expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Re-parsing must give back the same date, which it will not do if the
      // day overflowed into the following month.
      const [y, m, d] = date.split('-').map(Number) as [number, number, number];
      expect(new Date(Date.UTC(y, m - 1, d)).getUTCMonth()).toBe(m - 1);
    }
  });
});

describe('weekdayIndex and startOfWeek', () => {
  it('counts Monday as 0 and Sunday as 6', () => {
    expect(weekdayIndex('2026-10-12')).toBe(0); // Monday
    expect(weekdayIndex('2026-10-16')).toBe(4); // Friday
    expect(weekdayIndex('2026-10-17')).toBe(5); // Saturday
    expect(weekdayIndex('2026-10-18')).toBe(6); // Sunday
  });

  it('puts both 2026 clock changes on a Sunday', () => {
    // The engine's DST tests pivot on these two dates. They are Sundays by
    // definition of the EU rule, and if this file disagreed with that the
    // week grid would be a day out exactly on the weeks that matter most.
    expect(weekdayIndex('2026-03-29')).toBe(6);
    expect(weekdayIndex('2026-10-25')).toBe(6);
  });

  it('returns the Monday of the containing week', () => {
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12'); // already Monday
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12'); // Sunday looks back
    expect(startOfWeek('2026-10-19')).toBe('2026-10-19'); // next Monday
  });

  it('spans a month boundary without losing days', () => {
    const dates = weekDates('2026-11-01'); // a Sunday
    expect(dates).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('always returns seven consecutive days', () => {
    for (const anchor of ['2026-01-01', '2026-02-28', '2026-12-31', '2028-02-29']) {
      const dates = weekDates(anchor);
      expect(dates).toHaveLength(7);
      expect(weekdayIndex(dates[0]!)).toBe(0);
      for (let i = 1; i < 7; i += 1) expect(dates[i]).toBe(addDays(dates[i - 1]!, 1));
      expect(dates).toContain(anchor);
    }
  });
});

describe('startOfMonth, endOfMonth and sameMonth', () => {
  it('finds the first and last day of months of every length', () => {
    expect(startOfMonth('2026-10-16')).toBe('2026-10-01');
    expect(endOfMonth('2026-10-16')).toBe('2026-10-31'); // 31
    expect(endOfMonth('2026-11-16')).toBe('2026-11-30'); // 30
    expect(endOfMonth('2026-02-16')).toBe('2026-02-28'); // 28
    expect(endOfMonth('2028-02-16')).toBe('2028-02-29'); // 29
    expect(endOfMonth('2026-12-01')).toBe('2026-12-31'); // year end
  });

  it('compares the month, not the day', () => {
    expect(sameMonth('2026-10-01', '2026-10-31')).toBe(true);
    expect(sameMonth('2026-10-31', '2026-11-01')).toBe(false);
    // Same month number, different year.
    expect(sameMonth('2026-10-12', '2027-10-12')).toBe(false);
  });
});

describe('monthGrid', () => {
  it('is whole weeks, Monday to Sunday', () => {
    for (const anchor of ['2026-01-15', '2026-02-15', '2026-10-15', '2027-05-15', '2028-02-15']) {
      const cells = monthGrid(anchor);
      expect(cells.length % 7).toBe(0);
      expect(weekdayIndex(cells[0]!.date)).toBe(0);
      expect(weekdayIndex(cells[cells.length - 1]!.date)).toBe(6);
    }
  });

  it('contains every day of the month exactly once, and nothing missing', () => {
    for (const anchor of ['2026-02-15', '2026-10-15', '2028-02-15', '2026-11-15']) {
      const inMonth = monthGrid(anchor)
        .filter((c) => c.inMonth)
        .map((c) => c.date);
      const first = startOfMonth(anchor);
      const last = endOfMonth(anchor);

      const expected: string[] = [];
      for (let d = first; d <= last; d = addDays(d, 1)) expected.push(d);

      expect(inMonth).toEqual(expected);
      expect(new Set(inMonth).size).toBe(inMonth.length);
    }
  });

  it('marks the borrowed leading and trailing days as outside', () => {
    // October 2026 starts on a Thursday, so Mon–Wed come from September.
    const cells = monthGrid('2026-10-15');
    expect(cells[0]).toEqual({ date: '2026-09-28', inMonth: false });
    expect(cells[3]).toEqual({ date: '2026-10-01', inMonth: true });
    expect(cells[cells.length - 1]).toEqual({ date: '2026-11-01', inMonth: false });
  });

  it('uses five rows when the month fits and six when it does not', () => {
    // 35 cells, not a fixed 42: a permanently six-row grid leaves an empty
    // trailing week most months, which reads as a rendering fault.
    expect(monthGrid('2026-10-15')).toHaveLength(35);
    // February 2027 starts on a Monday and has 28 days — exactly four weeks.
    expect(monthGrid('2027-02-15')).toHaveLength(28);
    // August 2026 starts on a Saturday and has 31 days, which needs six rows.
    expect(monthGrid('2026-08-15')).toHaveLength(42);
  });

  it('never repeats or skips a date across the grid', () => {
    const cells = monthGrid('2026-08-15');
    for (let i = 1; i < cells.length; i += 1) {
      expect(cells[i]!.date).toBe(addDays(cells[i - 1]!.date, 1));
    }
  });
});

describe('rangeFor', () => {
  const past = '2020-01-01'; // "today", far enough back to never clamp

  it('asks for one day in day view', () => {
    expect(rangeFor('day', '2026-10-16', past)).toEqual({
      from: '2026-10-16',
      through: '2026-10-16',
    });
  });

  it('asks for a Monday-to-Sunday week in week view', () => {
    expect(rangeFor('week', '2026-10-16', past)).toEqual({
      from: '2026-10-12',
      through: '2026-10-18',
    });
    expect(inclusiveDays('2026-10-12', '2026-10-18')).toBe(7);
  });

  it('asks for the month itself, never the 42 cells of its grid', () => {
    // The grid borrows days from the neighbouring months; the request must
    // not. A six-row grid spans 42 days and the endpoint caps at 31.
    const range = rangeFor('month', '2026-08-15', past);
    expect(range).toEqual({ from: '2026-08-01', through: '2026-08-31' });
    expect(monthGrid('2026-08-15')).toHaveLength(42);
  });

  it('never exceeds the endpoint cap of 31 inclusive days, for any month', () => {
    // The assertion this file exists for. One month of one year slipping to
    // 32 is a 400 in production that nothing else would catch.
    for (let year = 2026; year <= 2030; year += 1) {
      for (let month = 1; month <= 12; month += 1) {
        const anchor = `${year}-${String(month).padStart(2, '0')}-15`;
        const { from, through } = rangeFor('month', anchor, past);
        const days = inclusiveDays(from, through);
        expect(days, `${anchor} asked for ${days} days`).toBeLessThanOrEqual(31);
        expect(days).toBeGreaterThanOrEqual(28);
      }
    }
  });

  it('clamps the start to today rather than asking about yesterday', () => {
    expect(rangeFor('month', '2026-10-15', '2026-10-28')).toEqual({
      from: '2026-10-28',
      through: '2026-10-31',
    });
    expect(rangeFor('week', '2026-10-16', '2026-10-15')).toEqual({
      from: '2026-10-15',
      through: '2026-10-18',
    });
  });

  it('never returns a range that ends before it starts', () => {
    // A period entirely in the past collapses to today rather than inverting,
    // which would make the endpoint reject the request outright.
    for (const view of ['month', 'week', 'day'] as const) {
      const { from, through } = rangeFor(view, '2020-03-15', '2026-10-11');
      expect(from <= through).toBe(true);
    }
  });

  it('leaves a future period unclamped', () => {
    expect(rangeFor('month', '2027-03-15', '2026-10-11')).toEqual({
      from: '2027-03-01',
      through: '2027-03-31',
    });
  });
});

describe('independence from the machine time zone', () => {
  // The bug this guards against works perfectly in Vienna and is a day out in
  // Georgia. Node re-reads process.env.TZ, so the same assertions can be run
  // either side of the world without spawning anything.
  // vi.stubEnv rather than touching process.env directly: it is typed, it
  // restores cleanly, and it keeps Node's globals out of a frontend tsconfig
  // that deliberately does not include them.
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  function snapshot() {
    return {
      weekday: weekdayIndex('2026-10-12'),
      week: weekDates('2026-10-16'),
      monthFirst: monthGrid('2026-10-15')[0]!.date,
      monthLast: monthGrid('2026-10-15').at(-1)!.date,
      monthLength: monthGrid('2026-10-15').length,
      range: rangeFor('month', '2026-10-15', '2020-01-01'),
      endOfFeb: endOfMonth('2028-02-10'),
      clamped: addMonths('2026-01-31', 1),
    };
  }

  it('gives identical answers at UTC+14, UTC-11 and UTC', () => {
    vi.stubEnv('TZ', 'UTC');
    const utc = snapshot();

    vi.stubEnv('TZ', 'Pacific/Kiritimati'); // UTC+14, the eastern extreme
    expect(snapshot()).toEqual(utc);

    vi.stubEnv('TZ', 'Pacific/Midway'); // UTC-11, the western extreme
    expect(snapshot()).toEqual(utc);

    vi.stubEnv('TZ', 'America/New_York'); // a zone that transitions in autumn
    expect(snapshot()).toEqual(utc);
  });

  it('is unaffected by a clock change in the machine zone', () => {
    // 25 October 2026 is the European transition. A grid built from local
    // Dates could lose or double that day.
    vi.stubEnv('TZ', 'Europe/Vienna');
    const vienna = monthGrid('2026-10-15').map((c) => c.date);
    vi.stubEnv('TZ', 'UTC');
    expect(monthGrid('2026-10-15').map((c) => c.date)).toEqual(vienna);
    expect(vienna).toContain('2026-10-25');
    expect(vienna.filter((d) => d === '2026-10-25')).toHaveLength(1);
  });
});
