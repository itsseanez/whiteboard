import { describe, expect, it } from 'vitest';
import { dateToIso, dayAndMonth, timeOfDay, timeOffLabel, weekdayShort } from './format';

// The parts are the viewer's locale's; what's tested is which parts appear.
const VIENNA = 'Europe/Vienna';
const day = (d: string) => `${weekdayShort(dateToIso(d), VIENNA)} ${dayAndMonth(dateToIso(d), VIENNA)}`;
const at = (iso: string) => timeOfDay(iso, VIENNA);

describe('timeOffLabel', () => {
  it('names a single whole day by itself', () => {
    expect(timeOffLabel('2026-12-23T23:00:00Z', '2026-12-24T23:00:00Z', VIENNA)).toBe(day('2026-12-24'));
  });

  it('ends whole days on the last day off, not the midnight after', () => {
    expect(timeOffLabel('2026-12-23T23:00:00Z', '2026-12-26T23:00:00Z', VIENNA)).toBe(
      `${day('2026-12-24')} – ${day('2026-12-26')}`,
    );
  });

  it('gives times for part of a day', () => {
    const s = '2026-12-24T08:00:00Z';
    const e = '2026-12-24T11:00:00Z';
    expect(timeOffLabel(s, e, VIENNA)).toBe(`${day('2026-12-24')}, ${at(s)}–${at(e)}`);
  });

  it('reads midnight in the organization, not in UTC', () => {
    // Midnight UTC is 01:00 in Vienna, so this is timed, not a whole day.
    expect(timeOffLabel('2026-12-24T00:00:00Z', '2026-12-25T00:00:00Z', VIENNA)).toContain(at('2026-12-24T00:00:00Z'));
  });

  it('says where a range with one timed end starts and stops', () => {
    const s = '2026-12-24T13:00:00Z';
    expect(timeOffLabel(s, '2026-12-26T23:00:00Z', VIENNA)).toBe(`${day('2026-12-24')}, ${at(s)} – ${day('2026-12-26')}`);
  });
});
