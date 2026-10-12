// Month and week grid arithmetic, on 'YYYY-MM-DD' strings.
//
// WHY THERE IS NO TIME ZONE IN THIS FILE
//
// Deciding what today's date is in the salon's zone is a zone question, and
// format.ts answers it with salonDate(). Everything after that — how many days
// October has, which weekday the 1st falls on, what the Monday of a given week
// is — is a property of the calendar, not of any zone. 2026-10-16 is a Friday
// in Vienna and a Friday in Kennesaw.
//
// So these functions take a date string and return date strings, and the only
// Date objects involved are used as a calendar calculator, pinned to UTC so the
// browser's own zone can never shift a result. A grid built from local-time
// Dates would be off by a day for anyone west of Greenwich for part of each
// day, which is the kind of bug that works perfectly in Vienna and fails in
// Georgia.

/** Monday = 0 … Sunday = 6. The grid is Monday-first. */
const MONDAY_FIRST_OFFSET = 6;

interface Parts {
  year: number;
  month: number; // 1-12
  day: number;
}

function parse(date: string): Parts {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

function toUtc({ year, month, day }: Parts): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function format(value: Date): string {
  // Not toISOString().slice(0,10): that is correct here only because the Date
  // is pinned to UTC midnight, and relying on that coincidence is how this
  // file would acquire a zone bug later. Building the string from the UTC
  // getters says what it means.
  const year = String(value.getUTCFullYear()).padStart(4, '0');
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(date: string, days: number): string {
  const value = toUtc(parse(date));
  value.setUTCDate(value.getUTCDate() + days);
  return format(value);
}

/**
 * Clamps the day of month, so adding a month to the 31st lands on the last day
 * of the shorter month rather than overflowing into the next one. Date's own
 * setUTCMonth rolls over: 31 January + 1 month would be 3 March.
 */
export function addMonths(date: string, months: number): string {
  const { year, month, day } = parse(date);
  const target = month - 1 + months;
  const targetYear = year + Math.floor(target / 12);
  const targetMonth = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return format(new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay))));
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: string): number {
  return (toUtc(parse(date)).getUTCDay() + MONDAY_FIRST_OFFSET) % 7;
}

export function startOfWeek(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

export function startOfMonth(date: string): string {
  const { year, month } = parse(date);
  return format(new Date(Date.UTC(year, month - 1, 1)));
}

export function endOfMonth(date: string): string {
  const { year, month } = parse(date);
  // Day 0 of the next month is the last day of this one.
  return format(new Date(Date.UTC(year, month, 0)));
}

export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

export interface GridCell {
  date: string;
  /** False for the leading and trailing days borrowed from the neighbouring months. */
  inMonth: boolean;
}

/**
 * The cells of a month view, Monday-first, padded to whole weeks.
 *
 * Five or six rows depending on where the 1st falls — not always six. A fixed
 * six-row grid means an empty trailing week in most months, and a calendar with
 * a blank row at the bottom reads as a rendering fault.
 */
export function monthGrid(anchor: string): GridCell[] {
  const first = startOfMonth(anchor);
  const last = endOfMonth(anchor);
  const start = startOfWeek(first);

  const cells: GridCell[] = [];
  let cursor = start;
  // Run to the end of the week that contains the last day of the month.
  const stop = addDays(startOfWeek(last), 7);
  while (cursor < stop) {
    cells.push({ date: cursor, inMonth: sameMonth(cursor, first) });
    const next = addDays(cursor, 1);
    // addDays always advances, for the UTC arithmetic above. The guard is
    // here because the failure mode if it ever stops advancing — someone
    // "simplifying" this to local Dates, where a midnight that does not
    // exist can land back on the same date — is this loop spinning the
    // browser's main thread forever. A frozen tab is a far worse bug than a
    // wrong grid, and much harder to recognise.
    if (next <= cursor) throw new Error(`calendar: addDays did not advance from ${cursor}`);
    cursor = next;
  }
  return cells;
}

/** The seven dates of the week containing `anchor`, Monday first. */
export function weekDates(anchor: string): string[] {
  const monday = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/**
 * The range to ask the availability endpoint for, given a view.
 *
 * The endpoint caps an inclusive range at 31 days, which is why a month view
 * requests the month's OWN days and never the 42 cells of its grid — a
 * six-row October grid spans 42 days and would be refused outright. The
 * borrowed cells are rendered inert instead, which is also the honest thing:
 * they belong to a month the customer has not navigated to.
 *
 * `today` clamps the start, because no view has any use for yesterday and a
 * month view opened on the 28th would otherwise ask for 27 dead days.
 */
export function rangeFor(
  view: 'month' | 'week' | 'day',
  anchor: string,
  today: string,
): { from: string; through: string } {
  const [from, through] =
    view === 'month'
      ? [startOfMonth(anchor), endOfMonth(anchor)]
      : view === 'week'
        ? [startOfWeek(anchor), addDays(startOfWeek(anchor), 6)]
        : [anchor, anchor];

  return { from: from < today ? today : from, through: through < today ? today : through };
}
