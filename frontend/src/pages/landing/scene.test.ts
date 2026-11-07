import { describe, expect, it } from 'vitest';
import type { Day } from '@/lib/api';
import { sceneFrame, SCENE_SLOTS } from './scene';

const slot = (startsAt: string) => ({ startsAt, endsAt: startsAt, staffIds: ['s1'] });
const times = (date: string, n: number) =>
  Array.from({ length: n }, (_, i) => slot(`${date}T${String(9 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00Z`));

// A small month: one closed day, one open day with nothing left, three open days.
const month = new Map<string, Day>([
  ['2026-11-01', { date: '2026-11-01', status: 'closed' }],
  ['2026-11-02', { date: '2026-11-02', status: 'open', slots: [] }],
  ['2026-11-03', { date: '2026-11-03', status: 'open', slots: times('2026-11-03', 12) }],
  ['2026-11-04', { date: '2026-11-04', status: 'open', slots: times('2026-11-04', 3) }],
  ['2026-11-05', { date: '2026-11-05', status: 'open', slots: times('2026-11-05', 5) }],
]);
const openFilled = (p: number) =>
  [...sceneFrame(p, month).days.values()].filter((d) => d.status === 'open').length;

describe('sceneFrame', () => {
  it('starts with the grid empty: closed days only, nothing picked', () => {
    const frame = sceneFrame(0, month);
    expect([...frame.days.keys()]).toEqual(['2026-11-01']);
    expect(frame).toMatchObject({ selected: null, slots: 0, slotOn: false });
  });

  it('fills the open days in as scrolling continues, all of them by the end of the fill', () => {
    expect(openFilled(0.15)).toBeGreaterThan(0);
    expect(openFilled(0.15)).toBeLessThan(4);
    expect(openFilled(0.35)).toBe(4);
  });

  it('then picks the first day that has times, skipping a day with none left', () => {
    expect(sceneFrame(0.38, month).selected).toBeNull();
    expect(sceneFrame(0.42, month).selected).toBe('2026-11-03');
  });

  it('then shows that day\'s times a few at a time, up to the cap', () => {
    const mid = sceneFrame(0.6, month).slots;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(SCENE_SLOTS);
    expect(sceneFrame(0.8, month)).toMatchObject({ slots: SCENE_SLOTS, slotOn: false });
  });

  it('turns one slot black only at the end', () => {
    expect(sceneFrame(0.84, month).slotOn).toBe(false);
    expect(sceneFrame(0.9, month).slotOn).toBe(true);
  });

  it('never shows more times than the day has', () => {
    const short = new Map<string, Day>([['2026-11-04', month.get('2026-11-04')!]]);
    expect(sceneFrame(1, short).slots).toBe(3);
  });

  it('treats progress outside 0..1 as the nearest end', () => {
    expect(sceneFrame(-2, month)).toEqual(sceneFrame(0, month));
    expect(sceneFrame(5, month)).toEqual(sceneFrame(1, month));
  });

  it('has nothing to pick in a month with no times at all', () => {
    const none = new Map<string, Day>([['2026-11-01', { date: '2026-11-01', status: 'closed' }]]);
    expect(sceneFrame(1, none)).toMatchObject({ selected: null, slots: 0, slotOn: false });
  });
});
