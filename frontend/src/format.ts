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
 * Does the viewer's own locale write 9:00 AM or 09:00?
 *
 * Asked of Intl rather than decided from a list. resolvedOptions() reports
 * the hour cycle the locale resolved to, but ONLY when an hour field was
 * requested — ask without `hour` and it comes back undefined, which is the
 * trap that makes this look broken.
 *
 * It also honours an explicit preference carried on the locale, so a viewer
 * whose browser reports en-US-u-hc-h23 gets 24-hour even in the States.
 *
 * h11 and h12 are both twelve-hour (they differ only in whether midnight is
 * 0 or 12); h23 and h24 are both twenty-four.
 */
function viewerUsesTwelveHour(): boolean {
  const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h12' || cycle === 'h11';
}

/**
 * '09:15', or '9:15 AM' for a viewer whose locale writes clocks that way.
 *
 * THE ZONE AND THE NOTATION ARE DIFFERENT QUESTIONS
 *
 * Which MOMENT to show is the salon's business: the instant is always
 * rendered in the salon's zone, so a customer in Kennesaw sees the time they
 * will be standing in the doorway in Vienna. That never follows the viewer.
 *
 * How to WRITE that moment is the viewer's business, and follows their
 * locale. The two are independent, and conflating them is what made an
 * earlier version key notation off the salon's country.
 *
 * It also makes this file consistent with itself. weekdayLong and dayAndMonth
 * already format in the viewer's locale — an American reads 'October 16' and
 * a Brit '16 October' — so pinning only the clock was the odd one out.
 *
 * Accepted cost: the same slot is written two ways to two people, so a
 * screenshot is not evidence of what anyone else sees, and anything asserting
 * on these strings has to pin a locale.
 */
export function timeOfDay(iso: string, timeZone: string): string {
  const twelve = viewerUsesTwelveHour();
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    // 'numeric' under a twelve-hour cycle, because hour:'2-digit' renders
    // '09:00 AM' and nobody writes that. '2-digit' under twenty-four, because
    // a column of times is scanned rather than read and '09:00' aligns with
    // '19:00'.
    hour: twelve ? 'numeric' : '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * The same time, padded so a column of them lines up.
 *
 * The chips in the week and day views are already identical boxes — measured
 * at 150px each. What jitters is the text in them: '9:00 AM' is 53px wide and
 * '10:00 AM' is 62px, so centring shifts the single-digit hours four pixels
 * right and the colons wander down the column.
 *
 * U+2007 FIGURE SPACE is a space defined to be exactly as wide as a digit.
 * Prefixing one to a single-digit hour makes every time in the column the
 * same width, and with font-variant-numeric: tabular-nums the colons and
 * minutes then sit on an exact vertical line.
 *
 * Padding rather than hour:'2-digit' because '09:00 AM' is not how anyone
 * writes it; this gets the alignment without the leading zero.
 *
 * Only single-digit hours match, so 24-hour output ('09:15', always two
 * digits) passes through untouched, as does any locale whose shape this
 * does not recognise.
 *
 * Not used by fullMoment: that is prose, where a leading gap after the comma
 * would be a flaw rather than an alignment.
 */
export function timeOfDayAligned(iso: string, timeZone: string): string {
  const text = timeOfDay(iso, timeZone);
  return /^\d:/.test(text) ? `\u2007${text}` : text;
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
