// Functions 5-7: rulesForDate, expandRule, expandOpenPeriods.
//
// This is where wall-clock rules become real moments, and the only part of the
// engine that knows time zones exist. The phase gate lives in expandRule.

import { describe, it, expect } from 'vitest';
import {
  expandOpenPeriods,
  expandRule,
  rulesForDate,
} from '../../src/availability/engine.js';
import {
  EU_FALL,
  EU_SPRING,
  KOLKATA,
  UTC,
  VIENNA,
  date,
  elapsedHours,
  everyDay,
  instant,
  rule,
  weekdaysOnly,
  zoned,
} from '../../src/availability/fixtures.js';

describe('rulesForDate', () => {
  it('picks the rules whose weekday matches the date', () => {
    const rules = [rule(1, '09:00', '17:00'), rule(2, '10:00', '18:00')];

    // 2026-06-15 is a Monday.
    expect(rulesForDate(rules, date('2026-06-15'))).toEqual([rule(1, '09:00', '17:00')]);
  });

  it('returns every rule for a weekday, in input order — a split shift', () => {
    const rules = [rule(1, '09:00', '12:00'), rule(1, '13:00', '17:00')];

    expect(rulesForDate(rules, date('2026-06-15'))).toEqual(rules);
  });

  it('returns nothing for a weekday with no rules — a closed day', () => {
    expect(rulesForDate([rule(1, '09:00', '17:00')], date('2026-06-16'))).toEqual([]);
  });

  it('treats Sunday as 7, not 0', () => {
    // 2026-06-21 is a Sunday. JavaScript's getDay() would say 0 here, which is
    // why anything coming from the browser has to be converted.
    const sunday = rule(7, '11:00', '15:00');

    expect(rulesForDate([sunday], date('2026-06-21'))).toEqual([sunday]);
    expect(rulesForDate([rule(1, '11:00', '15:00')], date('2026-06-21'))).toEqual([]);
  });
});

describe('expandRule', () => {
  it('places an ordinary day at the right moments', () => {
    const span = expandRule(rule(1, '09:00', '17:00'), date('2026-07-13'), VIENNA);

    // July is CEST (+02:00).
    expect(span.startsAt).toEqual(instant('2026-07-13T07:00:00Z'));
    expect(span.endsAt).toEqual(instant('2026-07-13T15:00:00Z'));
  });

  it('keeps a 9-to-5 day eight hours long on the day the clocks go back', () => {
    const span = expandRule(rule(7, '09:00', '17:00'), date(EU_FALL), VIENNA);

    // The project's own scope doc claimed this day becomes 7 or 9 hours. It does
    // not: the change happens at 03:00, nowhere near business hours.
    expect(elapsedHours(span)).toBe(8);

    // Position is what actually matters. The transition is at 03:00, so by 09:00
    // the 25th is ALREADY on CET (+01:00) — this day's 09:00 is 08:00Z, not
    // 07:00Z. A bug that reused another date's offset would keep the length at
    // eight hours while putting the day in the wrong place, so a test asserting
    // only the length passes on broken code.
    expect(span.startsAt).toEqual(instant('2026-10-25T08:00:00Z'));
  });

  it('puts the day after the change at the same moment as the change day', () => {
    const fallDay = expandRule(rule(7, '09:00', '17:00'), date(EU_FALL), VIENNA);
    const dayAfter = expandRule(rule(1, '09:00', '17:00'), date('2026-10-26'), VIENNA);

    // Both on CET, so both open at 08:00Z — 24 hours apart.
    expect(dayAfter.startsAt).toEqual(instant('2026-10-26T08:00:00Z'));
    expect(dayAfter.startsAt.since(fallDay.startsAt).total('hours')).toBe(24);
  });

  it('keeps a 9-to-5 day eight hours long on the day the clocks go forward', () => {
    const span = expandRule(rule(7, '09:00', '17:00'), date(EU_SPRING), VIENNA);

    expect(elapsedHours(span)).toBe(8);
    // Already on CEST by 09:00, since the change is at 02:00.
    expect(span.startsAt).toEqual(instant('2026-03-29T07:00:00Z'));
  });

  it('reads an end time of 00:00 as the start of the next day', () => {
    const span = expandRule(rule(6, '18:00', '00:00'), date('2026-10-24'), VIENNA);

    expect(span.endsAt).toEqual(zoned(EU_FALL, '00:00'));
    expect(elapsedHours(span)).toBe(6);
  });

  it('keeps an evening six hours long even when the day is 25 hours', () => {
    // The 25th has an extra hour, but it sits at 03:00 — outside this rule.
    const span = expandRule(rule(7, '18:00', '00:00'), date(EU_FALL), VIENNA);

    expect(elapsedHours(span)).toBe(6);
  });

  it("gives a bar closing at 02:00 the extra hour it trades on fall-back night", () => {
    // The 'later' disambiguation decision, made visible. 02:00 happens twice on
    // the 25th; taking the second occurrence means 00:00 to 02:00 is THREE
    // elapsed hours. 'compatible' would take the first and give two.
    const span = expandRule(rule(7, '00:00', '02:00'), date(EU_FALL), VIENNA);

    expect(elapsedHours(span)).toBe(3);
  });

  it('pushes a closing time of 02:00 past the gap on spring-forward night', () => {
    // 02:00 does not exist on the 29th, so the end resolves forward to 03:00.
    // 00:00 CET to 03:00 CEST is two elapsed hours, not three — the hour in
    // between never happened.
    const span = expandRule(rule(7, '00:00', '02:00'), date(EU_SPRING), VIENNA);

    expect(elapsedHours(span)).toBe(2);
  });

  it('handles a zone whose offset is not a whole number of hours', () => {
    // Asia/Kolkata is +05:30 and never shifts, so this catches any assumption
    // that offsets are whole hours.
    const span = expandRule(rule(1, '09:00', '17:00'), date('2026-06-15'), KOLKATA);

    expect(span.startsAt).toEqual(instant('2026-06-15T03:30:00Z'));
    expect(elapsedHours(span)).toBe(8);
  });

  it('is unremarkable in a zone that never changes', () => {
    const span = expandRule(rule(1, '09:00', '17:00'), date(EU_FALL), UTC);

    expect(span.startsAt).toEqual(instant('2026-10-25T09:00:00Z'));
    expect(elapsedHours(span)).toBe(8);
  });
});

describe('expandOpenPeriods', () => {
  const week = [
    '2026-06-15', // Monday
    '2026-06-16',
    '2026-06-17',
    '2026-06-18',
    '2026-06-19',
    '2026-06-20', // Saturday
    '2026-06-21', // Sunday
  ].map(date);

  it('produces one period per open weekday and nothing for closed ones', () => {
    const periods = expandOpenPeriods(weekdaysOnly('09:00', '17:00'), week, VIENNA);

    expect(periods).toHaveLength(5);
    expect(periods[0]?.startsAt).toEqual(zoned('2026-06-15', '09:00'));
    expect(periods[4]?.startsAt).toEqual(zoned('2026-06-19', '09:00'));
  });

  it('keeps a real lunch gap open as two periods', () => {
    const splitShift = [rule(1, '09:00', '12:00'), rule(1, '13:00', '17:00')];

    const periods = expandOpenPeriods(splitShift, [date('2026-06-15')], VIENNA);

    expect(periods).toHaveLength(2);
    expect(periods[0]?.endsAt).toEqual(zoned('2026-06-15', '12:00'));
    expect(periods[1]?.startsAt).toEqual(zoned('2026-06-15', '13:00'));
  });

  it('glues two shifts that touch into one period', () => {
    const touching = [rule(1, '09:00', '13:00'), rule(1, '13:00', '17:00')];

    expect(expandOpenPeriods(touching, [date('2026-06-15')], VIENNA)).toEqual([
      { startsAt: zoned('2026-06-15', '09:00'), endsAt: zoned('2026-06-15', '17:00') },
    ]);
  });

  it('unions two overlapping rows the owner UI allowed', () => {
    const overlapping = [rule(1, '09:00', '13:00'), rule(1, '11:00', '17:00')];

    expect(expandOpenPeriods(overlapping, [date('2026-06-15')], VIENNA)).toEqual([
      { startsAt: zoned('2026-06-15', '09:00'), endsAt: zoned('2026-06-15', '17:00') },
    ]);
  });

  it('leaves separate evenings separate', () => {
    // 18:00-00:00 every day is seven six-hour evenings, not one long stretch:
    // Monday's period ends at midnight and Tuesday's does not begin until 18:00,
    // so there is nothing to glue. Worth pinning, because it is the case a
    // too-eager merge would collapse.
    const periods = expandOpenPeriods(everyDay('18:00', '00:00'), week, VIENNA);

    expect(periods).toHaveLength(7);
    expect(periods[0]).toEqual({
      startsAt: zoned('2026-06-15', '18:00'),
      endsAt: zoned('2026-06-16', '00:00'),
    });
  });

  it('glues each evening to the small hours that follow it', () => {
    // The real overnight case: a bar open 18:00-02:00 stores two rows per day,
    // and each evening glues to the next morning's tail — seven eight-hour
    // stretches, not fourteen fragments.
    const overnight = [...everyDay('18:00', '00:00'), ...everyDay('00:00', '02:00')];

    const periods = expandOpenPeriods(overnight, week, VIENNA);

    expect(periods[0]).toEqual({
      startsAt: zoned('2026-06-15', '00:00'),
      endsAt: zoned('2026-06-15', '02:00'),
    });
    expect(periods[1]).toEqual({
      startsAt: zoned('2026-06-15', '18:00'),
      endsAt: zoned('2026-06-16', '02:00'),
    });
  });

  it("includes the previous day's overnight tail when that day is in the list", () => {
    // Why computeAvailability pads the date list. A bar open 18:00-02:00 on
    // Friday is open at 00:30 on Saturday; expanding Saturday alone loses it.
    const overnight = [rule(5, '18:00', '00:00'), rule(6, '00:00', '02:00')]; // Fri + Sat

    const saturdayOnly = expandOpenPeriods(overnight, [date('2026-06-20')], VIENNA);
    const padded = expandOpenPeriods(overnight, [date('2026-06-19'), date('2026-06-20')], VIENNA);

    expect(saturdayOnly[0]?.startsAt).toEqual(zoned('2026-06-20', '00:00'));
    // With Friday present the two halves glue, and the stretch starts Friday
    // evening instead of at midnight.
    expect(padded).toEqual([
      { startsAt: zoned('2026-06-19', '18:00'), endsAt: zoned('2026-06-20', '02:00') },
    ]);
  });

  it('returns nothing when no rule matches any date', () => {
    expect(expandOpenPeriods([rule(7, '11:00', '15:00')], [date('2026-06-15')], VIENNA)).toEqual(
      [],
    );
  });
});
