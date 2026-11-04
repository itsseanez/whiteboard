// A weekly pattern of wall-clock ranges: business hours or one staff member's
// working hours. Weekday is ISO (1 = Monday … 7 = Sunday), times are local
// HH:MM in the tenant's zone, and an end of 00:00 means midnight at the end of
// that day. Several ranges per day are allowed (split shifts); overlaps are not.

export interface HoursRange {
  weekday: number;
  start: string; // HH:MM
  end: string; // HH:MM, or 00:00 for end of day
}

export type ParsedHours = { ok: true; value: HoursRange[] } | { ok: false; error: string };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_RANGES = 50;

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
}

// Minutes from the start of the day, with 00:00 as an end meaning 24:00.
function endMinutes(hhmm: string): number {
  return hhmm === '00:00' ? 24 * 60 : minutes(hhmm);
}

export function parseWeeklyHours(body: unknown): ParsedHours {
  const hours = (body as { hours?: unknown } | null)?.hours;
  if (!Array.isArray(hours)) return { ok: false, error: 'hours must be an array' };
  if (hours.length > MAX_RANGES) return { ok: false, error: `at most ${MAX_RANGES} ranges` };

  const ranges: HoursRange[] = [];
  for (const item of hours) {
    const { weekday, start, end } = (item ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(weekday) || (weekday as number) < 1 || (weekday as number) > 7) {
      return { ok: false, error: 'weekday must be 1 (Monday) to 7 (Sunday)' };
    }
    if (typeof start !== 'string' || !HHMM.test(start) || typeof end !== 'string' || !HHMM.test(end)) {
      return { ok: false, error: 'start and end must be HH:MM' };
    }
    // Matches the table's CHECK, which has no way to say "all 24 hours".
    if (start === '00:00' && end === '00:00') {
      return { ok: false, error: '00:00–00:00 is not allowed; use 00:00–23:59' };
    }
    if (endMinutes(end) <= minutes(start)) {
      return { ok: false, error: `${start}–${end} ends before it starts` };
    }
    ranges.push({ weekday: weekday as number, start, end });
  }

  // Sorted by day then start, an overlap can only be with the previous range.
  ranges.sort((a, b) => a.weekday - b.weekday || minutes(a.start) - minutes(b.start));
  for (let i = 1; i < ranges.length; i++) {
    const prev = ranges[i - 1]!;
    const cur = ranges[i]!;
    if (prev.weekday === cur.weekday && minutes(cur.start) < endMinutes(prev.end)) {
      return { ok: false, error: `${prev.start}–${prev.end} and ${cur.start}–${cur.end} overlap` };
    }
  }

  return { ok: true, value: ranges };
}

/** Postgres returns `time` as HH:MM:SS; the API speaks HH:MM. */
export function toHHMM(time: string): string {
  return time.slice(0, 5);
}
