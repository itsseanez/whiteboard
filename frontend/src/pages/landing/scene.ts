// What the pinned scroll scene shows at a given scroll progress (0..1).
// A pure function of progress, so scrolling back plays the scene in reverse.
//
// Stages: open days fill in, the first day with times is picked, its times
// appear a few at a time, then one turns black.

import type { Day } from '../../api';

export const SCENE_SLOTS = 8;

const FILL_END = 0.35;
const PICK_AT = 0.4;
const TIMES_START = 0.45;
const TIMES_END = 0.8;
const ON_AT = 0.85;

export interface Frame {
  /** What MonthGrid gets: closed days always, open days once filled in. */
  days: Map<string, Day>;
  selected: string | null;
  /** How many of the selected day's times to show. */
  slots: number;
  slotOn: boolean;
}

export function sceneFrame(progress: number, month: Map<string, Day>): Frame {
  const p = Math.min(1, Math.max(0, progress));
  const all = [...month.values()];
  const open = all.filter((day) => day.status === 'open');

  const filled = Math.floor((Math.min(p, FILL_END) / FILL_END) * open.length);
  const shown = new Set(open.slice(0, filled).map((day) => day.date));
  const days = new Map(all.filter((d) => d.status === 'closed' || shown.has(d.date)).map((d) => [d.date, d]));

  const target = open.find((day) => day.status === 'open' && day.slots.length > 0);
  const selected = p >= PICK_AT && target ? target.date : null;

  const cap = target?.status === 'open' ? Math.min(SCENE_SLOTS, target.slots.length) : 0;
  const along = Math.min(1, Math.max(0, (p - TIMES_START) / (TIMES_END - TIMES_START)));
  const slots = selected ? Math.floor(along * cap) : 0;

  return { days, selected, slots, slotOn: p >= ON_AT && slots > 0 };
}
