// Dates and times, always in the SALON's zone — never the browser's.
//
// This is the whole reason the API returns `timeZone` next to the instants. A
// customer in Kennesaw booking at Studio Wien must see 09:00, the time they
// will stand in the doorway, not 03:00 their own time. Every function here
// therefore takes the zone explicitly; none of them can fall back to the
// local one, because a default would be silently wrong for exactly the case
// this project exists to get right.
//
// Intl.DateTimeFormat, not Temporal. Temporal is in Node 26 on the server, but
// Safari does not ship it in a stable release, and this code runs in whatever
// browser the customer has. That is a recorded decision, not an oversight.

/** 'Thursday' */
export function weekdayLong(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'long' }).format(new Date(iso));
}

/** 'Thu' */
export function weekdayShort(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, weekday: 'short' }).format(new Date(iso));
}

/** '16 October' */
export function dayAndMonth(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, day: 'numeric', month: 'long' }).format(
    new Date(iso),
  );
}

/** '16' */
export function dayOfMonth(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, { timeZone, day: 'numeric' }).format(new Date(iso));
}

/**
 * '09:15'.
 *
 * hourCycle is pinned to h23 rather than left to the locale. A column of times
 * is being scanned, not read, and '1:00 PM' sorts and aligns worse than
 * '13:00' when forty of them sit in a row. The date formats above stay
 * locale-sensitive; only this one is fixed, and on purpose.
 */
export function timeOfDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** 'Thursday 16 October, 09:15' — for a confirmation, where context matters. */
export function fullMoment(iso: string, timeZone: string): string {
  return `${weekdayLong(iso, timeZone)} ${dayAndMonth(iso, timeZone)}, ${timeOfDay(iso, timeZone)}`;
}

/** '2h 30m', '45m' */
export function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/**
 * The salon's own calendar dates, as 'YYYY-MM-DD' strings for the API.
 *
 * Built with `en-CA`, whose short date format is ISO, rather than by slicing
 * `toISOString()` — which would give the UTC date. At 23:00 in Vienna the UTC
 * date is still yesterday, so slicing would ask the API about the wrong day
 * every evening. That bug would be invisible in Kennesaw and permanent in
 * Vienna.
 */
export function salonDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Today in the salon's zone, then the next `count - 1` days. */
export function dateRange(timeZone: string, count: number): string[] {
  const dates: string[] = [];
  const now = Date.now();
  for (let i = 0; i < count; i += 1) {
    // Adding whole days in UTC milliseconds and re-formatting in the target
    // zone is safe across a clock change: the formatter decides what calendar
    // date each moment falls on, so a 23-hour day is never skipped and a
    // 25-hour day is never doubled. Adding to a local wall clock would do both.
    dates.push(salonDate(new Date(now + i * 86_400_000), timeZone));
  }
  return dates;
}

/** Midday UTC on a 'YYYY-MM-DD', for formatting a date that has no time. */
export function dateToIso(date: string): string {
  // Midday, not midnight: formatting a date-only value in a zone shifts it by
  // the offset, and midnight UTC in Vienna is 01:00 the same day while in
  // Kennesaw it is 19:00 the day BEFORE. Midday has twelve hours of slack
  // either way, which no real zone offset comes close to.
  return `${date}T12:00:00Z`;
}
