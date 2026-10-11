// Given a service and a date range: which start times are bookable, and why the
// rest aren't. Pure — no database, no network, no clock, so the clock-change
// days are testable with a fake "now".
//
//   weekly rules ─▶ real moments ─▶ 15-min grid ─▶ judge each ─▶ result
//     (5-7)                           (8-9)          (10)        (11-12)
//
// Intervals are half-open: [start, end). Weekdays are 1=Monday..7=Sunday.
//
// Two spans per booking. A 10:00 haircut, 60 min, 10-min before-buffer, 5 after:
//   service  10:00-11:00  checked against business hours, shifts, time off
//   blocked  09:50-11:05  checked against appointments and resources

import type {
  AvailabilityDay,
  BusyInterval,
  AvailabilityInput,
  AvailabilityResult,
  ExcludedTime,
  Interval,
  ResourceConflict,
  Slot,
  StaffReason,
  TimeZone,
  WeekdayHours,
} from './types.js';

/** Minutes between candidate start times, on the business's wall clock. */
const GRID_MINUTES = 15;

const MIDNIGHT = Temporal.PlainTime.from('00:00');

const compare = Temporal.Instant.compare;

// ===========================================================================
// PART 1 · INTERVAL ARITHMETIC (1-4)
// ===========================================================================

/**
 * Do two spans collide? Touching is not colliding: 09:00-10:00 and 10:00-11:00
 * are false, so back-to-back bookings don't look double-booked.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return compare(a.startsAt, b.endsAt) < 0 && compare(b.startsAt, a.endsAt) < 0;
}

/**
 * What two spans share, or null if nothing: later of the starts, earlier of the
 * ends. null rather than a zero-length span, which could be passed on and
 * treated as real time.
 */
export function intersect(a: Interval, b: Interval): Interval | null {
  const startsAt = compare(a.startsAt, b.startsAt) >= 0 ? a.startsAt : b.startsAt;
  const endsAt = compare(a.endsAt, b.endsAt) <= 0 ? a.endsAt : b.endsAt;
  return compare(startsAt, endsAt) < 0 ? { startsAt, endsAt } : null;
}

/** Is `inner` entirely within `outer`? Endpoints may coincide. */
export function contains(outer: Interval, inner: Interval): boolean {
  return compare(outer.startsAt, inner.startsAt) <= 0 && compare(inner.endsAt, outer.endsAt) <= 0;
}

/**
 * Cut `busy` out of `from`. Returns 0, 1 or 2 pieces — two when `busy` lands in
 * the middle, which is why this returns an array.
 */
export function subtract(from: Interval, busy: Interval): Interval[] {
  if (!overlaps(from, busy)) return [{ startsAt: from.startsAt, endsAt: from.endsAt }];

  const pieces: Interval[] = [];
  if (compare(from.startsAt, busy.startsAt) < 0) {
    pieces.push({ startsAt: from.startsAt, endsAt: busy.startsAt });
  }
  if (compare(busy.endsAt, from.endsAt) < 0) {
    pieces.push({ startsAt: busy.endsAt, endsAt: from.endsAt });
  }
  return pieces;
}

/**
 * Sort by start, glue anything overlapping or touching.
 *
 * The glue test is `<=`, so touching merges here even though touching isn't a
 * collision in `overlaps`. Different questions: "would booking this collide"
 * (no) versus "is this one continuous stretch of open time" (yes). The second
 * is what lets an overnight pair stored as 18:00-00:00 + 00:00-02:00 come back
 * as one period a service can be booked across.
 *
 * Copies before sorting — `.sort()` would reorder the caller's array.
 */
export function mergeTouching(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => compare(a.startsAt, b.startsAt));

  const merged: Interval[] = [];
  for (const interval of sorted) {
    const current = merged.at(-1);
    if (current && compare(interval.startsAt, current.endsAt) <= 0) {
      // Extend only if this one actually reaches further — a short span sitting
      // inside a long one must not shrink it.
      if (compare(interval.endsAt, current.endsAt) > 0) current.endsAt = interval.endsAt;
    } else {
      merged.push({ startsAt: interval.startsAt, endsAt: interval.endsAt });
    }
  }
  return merged;
}

// ===========================================================================
// PART 2 · EXPANSION (5-7)
//
// Weekly wall-clock rules into real moments. The only section that knows zones
// exist. "09:00" isn't a moment until you name a date and a zone — and days
// aren't always 24 hours, one local hour can happen twice, and one can not
// happen at all.
// ===========================================================================

/**
 * The rules for a date. An array, because split shifts are two rows; [] means
 * closed.
 */
export function rulesForDate(
  rules: readonly WeekdayHours[],
  date: Temporal.PlainDate,
): WeekdayHours[] {
  return rules.filter((rule) => rule.weekday === date.dayOfWeek);
}

/**
 * One rule + one date + one zone → the two moments it means.
 *
 * An end of 00:00 means end of day: the start of the NEXT day in this zone.
 * `PlainDate.toZonedDateTime` with no time gives that day's first valid moment,
 * which is usually midnight but isn't in zones that shift at midnight — hence
 * "start of the next day" rather than "00:00".
 *
 * Boundaries resolve toward the longest real trading day: 'compatible' for the
 * start (a nonexistent time pushes forward, an ambiguous one takes the first
 * occurrence — open at the earliest real opportunity) and 'later' for the end
 * (pushes forward identically in spring, but takes the SECOND occurrence on
 * fall-back night, so a bar open until 02:00 gets the hour it actually trades).
 */
export function expandRule(
  rule: WeekdayHours,
  date: Temporal.PlainDate,
  timeZone: TimeZone,
): Interval {
  const startsAt = date
    .toPlainDateTime(rule.startTime)
    .toZonedDateTime(timeZone, { disambiguation: 'compatible' })
    .toInstant();

  const endsAt = rule.endTime.equals(MIDNIGHT)
    ? date.add({ days: 1 }).toZonedDateTime(timeZone).toInstant()
    : date
      .toPlainDateTime(rule.endTime)
      .toZonedDateTime(timeZone, { disambiguation: 'later' })
      .toInstant();

  return { startsAt, endsAt };
}

/**
 * Expand a rule set across a run of dates and merge. Used for business hours
 * and, per staff member, for working hours.
 *
 * The caller passes a padded date list — one day either side of the requested
 * range — because an 18:00-00:00 rule on the day before contributes open time
 * inside the range, and the two halves of an overnight stretch can only glue
 * while both are present. Periods outside the range are harmless: `computeDay`
 * selects by overlap with its own date.
 */
export function expandOpenPeriods(
  rules: readonly WeekdayHours[],
  dates: readonly Temporal.PlainDate[],
  timeZone: TimeZone,
): Interval[] {
  const expanded: Interval[] = [];
  for (const date of dates) {
    for (const rule of rulesForDate(rules, date)) {
      expanded.push(expandRule(rule, date, timeZone));
    }
  }
  return mergeTouching(expanded);
}

// ===========================================================================
// PART 3 · THE GRID (8-9)
// ===========================================================================

/**
 * Candidate start times inside one open period, on local quarter hours.
 *
 * The walk is a ZonedDateTime advanced by 15 minutes of exact time, which has
 * two consequences worth knowing, and they are NOT symmetrical:
 *
 * · Spring forward: nonexistent local times never appear. Walking exact time
 *   from 01:45 CET lands on 03:00 CEST — the missing hour is skipped for free,
 *   with no detection needed.
 *
 * · Fall back: the repeated hour appears TWICE. From 02:45 CEST, fifteen
 *   minutes of exact time is 02:00 CET — the wall clock goes backwards. The
 *   decision is to offer only the first pass so every displayed time is
 *   unambiguous, which is what `seen` is for. The second pass is lost once a
 *   year, knowingly.
 *
 * First time is the period's start rounded UP to a quarter hour, so a salon
 * opening 09:10 offers 09:15. Last is strictly before the period's end — a
 * booking starting at closing has nowhere to go. Whether the service FITS
 * before closing is `evaluateGridTime`'s decision, not this one's.
 */
export function gridTimes(openPeriod: Interval, timeZone: TimeZone): Temporal.Instant[] {
  let cursor = openPeriod.startsAt.toZonedDateTimeISO(timeZone).round({
    smallestUnit: 'minute',
    roundingIncrement: GRID_MINUTES,
    roundingMode: 'ceil',
  });

  const times: Temporal.Instant[] = [];
  const seen = new Set<string>();

  while (compare(cursor.toInstant(), openPeriod.endsAt) < 0) {
    const wallClock = cursor.toPlainDateTime().toString();
    if (!seen.has(wallClock)) {
      seen.add(wallClock);
      times.push(cursor.toInstant());
    }
    cursor = cursor.add({ minutes: GRID_MINUTES });
  }
  return times;
}

/**
 * One candidate start → the two spans it implies. `blocked` is also what the
 * appointment row stores for the database's double-booking constraint.
 */
export function blockedIntervalFor(
  start: Temporal.Instant,
  service: AvailabilityInput['service'],
): { service: Interval; blocked: Interval } {
  const endsAt = start.add(service.duration);
  return {
    service: { startsAt: start, endsAt },
    blocked: {
      startsAt: start.subtract(service.beforeBuffer),
      endsAt: endsAt.add(service.afterBuffer),
    },
  };
}

// ===========================================================================
// PART 4 · EVALUATION (10)
// ===========================================================================

/** One staff member's day, already in real moments. Built once per request. */
export interface StaffDaySchedule {
  readonly staffId: string;
  readonly workingPeriods: readonly Interval[];
  readonly timeOff: readonly Interval[];
  /** Existing appointments — already include their buffers. */
  readonly busyIntervals: readonly BusyInterval[];
}

/** Everything one candidate needs to be judged. */
export interface GridTimeContext {
  readonly startsAt: Temporal.Instant;
  /** The period this came from — i.e. when the business shuts. */
  readonly openPeriod: Interval;
  /** now + minimum notice, worked out once. */
  readonly earliestBookableAt: Temporal.Instant;
  readonly service: AvailabilityInput['service'];
  readonly staff: readonly StaffDaySchedule[];
  readonly resources: AvailabilityInput['resourceCandidates'];
}

/**
 * Why this staff member can't take the slot, or null if they can.
 *
 * Note which span each check uses. Shifts and time off constrain the SERVICE
 * interval; appointments constrain the BLOCKED one. That's what lets a stylist
 * whose shift starts at 09:00 take a 09:00 booking whose buffer reaches back to
 * 08:50 — buffers are prep, not work — while still refusing a buffer that runs
 * into someone else's appointment.
 */
function staffReasonFor(
  staff: StaffDaySchedule,
  serviceInterval: Interval,
  blocked: Interval,
): StaffReason | null {
  // Containment against the MERGED periods. `.some()` is equivalent to "inside
  // the union of their shifts" only because mergeTouching glued touching ones:
  // on unmerged periods a service spanning two adjacent shifts would be inside
  // the union but inside neither period.
  if (!staff.workingPeriods.some((period) => contains(period, serviceInterval))) {
    return { reason: 'outsideWorkingHours', staffId: staff.staffId };
  }

  const timeOff = staff.timeOff.find((off) => overlaps(serviceInterval, off));
  if (timeOff) return { reason: 'timeOff', staffId: staff.staffId, timeOff };

  const busyInterval = staff.busyIntervals.find((busy) => overlaps(blocked, busy));
  if (busyInterval) return { reason: 'busy', staffId: staff.staffId, busyInterval };

  return null;
}

/**
 * Judge one candidate: a Slot with everyone who could take it, or an
 * ExcludedTime saying why not.
 *
 * Business-wide reasons come first and stop the rest — if the salon shuts at
 * 17:00, "all six stylists are busy" is both useless and misleading.
 *
 * Resources are checked after staff, so a time failing both reports the staff
 * reasons. In that situation they're usually the same appointments seen from
 * two angles — the stylists are busy doing appointments, and those appointments
 * hold the resources — so the staff reasons name the cause. When only the
 * resource is held, no staff reason exists and 'noAvailableResource' is
 * reported as the sole cause, which is correct.
 */
export function evaluateGridTime(context: GridTimeContext): Slot | ExcludedTime {
  const { service: serviceInterval, blocked } = blockedIntervalFor(
    context.startsAt,
    context.service,
  );

  if (compare(serviceInterval.startsAt, context.earliestBookableAt) < 0) {
    return {
      startsAt: context.startsAt,
      reason: { reason: 'tooSoon', earliestBookableAt: context.earliestBookableAt },
    };
  }

  if (!contains(context.openPeriod, serviceInterval)) {
    return {
      startsAt: context.startsAt,
      reason: { reason: 'doesNotFitBeforeClosing', closesAt: context.openPeriod.endsAt },
    };
  }

  const staffIds: string[] = [];
  const staffReasons: StaffReason[] = [];
  for (const staff of context.staff) {
    const reason = staffReasonFor(staff, serviceInterval, blocked);
    if (reason) staffReasons.push(reason);
    else staffIds.push(staff.staffId);
  }
  // The complete set — one reason per staff member, so a consumer can say "all
  // of them" with confidence.
  if (staffIds.length === 0) return { startsAt: context.startsAt, reason: staffReasons };

  const resourceIds: string[] = [];
  const conflicts: ResourceConflict[] = [];
  for (const resource of context.resources) {
    const busyInterval = resource.busyIntervals.find((busy) => overlaps(blocked, busy));
    if (busyInterval) conflicts.push({ resourceId: resource.resourceId, busyInterval });
    else resourceIds.push(resource.resourceId);
  }
  // Only a service that needs a resource can fail for want of one.
  if (context.resources.length > 0 && resourceIds.length === 0) {
    return { startsAt: context.startsAt, reason: { reason: 'noAvailableResource', conflicts } };
  }

  return { ...serviceInterval, staffIds, resourceIds };
}

/**
 * Narrow `ExcludedTime.reason` to the per-staff set.
 *
 * A bare `Array.isArray(reason)` does NOT narrow it: that guard's signature
 * narrows to `any[]`, and `readonly StaffReason[]` is not assignable to it, so
 * TypeScript leaves the union intact and every property access errors. This is
 * the working version, and the controller rendering reasons needs it too.
 */
export function isStaffReasons(
  reason: ExcludedTime['reason'],
): reason is readonly StaffReason[] {
  return Array.isArray(reason);
}

// ===========================================================================
// PART 5 · ASSEMBLY (11-12)
// ===========================================================================

/**
 * One date → one day's answer.
 *
 * `businessPeriods` covers the whole padded window, because an overnight period
 * belongs to two dates. This day's periods are the ones overlapping its span in
 * the business's zone.
 *
 * Two different spans are in play per period, and swapping them is a real bug:
 * grid times come from the period CLIPPED to this date, so each candidate falls
 * on the right date, while the period passed to `evaluateGridTime` is the
 * UNCLIPPED one, so "fits before closing" uses the real closing time. Clip both
 * and a 23:30 booking gets rejected for running past midnight.
 *
 * No periods → 'closed', with no `slots` or `excluded` properties at all.
 * Absent, not empty: an empty slot list reads as "open but nothing free".
 */
export function computeDay(
  date: Temporal.PlainDate,
  businessPeriods: readonly Interval[],
  input: AvailabilityInput,
  staffSchedules: readonly StaffDaySchedule[],
): AvailabilityDay {
  const { timeZone } = input.request;
  const daySpan: Interval = {
    startsAt: date.toZonedDateTime(timeZone).toInstant(),
    endsAt: date.add({ days: 1 }).toZonedDateTime(timeZone).toInstant(),
  };

  const periodsToday = businessPeriods.filter((period) => overlaps(period, daySpan));
  if (periodsToday.length === 0) return { date, status: 'closed' };

  const earliestBookableAt = input.request.now.add(input.service.minimumNotice);
  const slots: Slot[] = [];
  const excluded: ExcludedTime[] = [];

  for (const period of periodsToday) {
    const clipped = intersect(period, daySpan);
    if (!clipped) continue; // unreachable: overlaps() already said they meet

    for (const startsAt of gridTimes(clipped, timeZone)) {
      const verdict = evaluateGridTime({
        startsAt,
        openPeriod: period,
        earliestBookableAt,
        service: input.service,
        staff: staffSchedules,
        resources: input.resourceCandidates,
      });
      if ('staffIds' in verdict) slots.push(verdict);
      else excluded.push(verdict);
    }
  }

  return { date, status: 'open', slots, excluded };
}

/**
 * The entry point.
 *
 * `now` arrives in the input and is never read from a clock — the only reason
 * the clock-change tests can exist, and the payoff of "SQL fetches, TypeScript
 * computes".
 */
export function computeAvailability(input: AvailabilityInput): AvailabilityResult {
  const { timeZone, fromDate, throughDate } = input.request;

  // A calendar walk on PlainDate, which has no zone, so no clock change can
  // touch it. (Adding days to an Instant is refused by Temporal for exactly the
  // reason this is safe: calendar days and 24-hour spans are different things.)
  const dates: Temporal.PlainDate[] = [];
  for (
    let date = fromDate;
    Temporal.PlainDate.compare(date, throughDate) <= 0;
    date = date.add({ days: 1 })
  ) {
    dates.push(date);
  }

  // No qualified staff still returns the calendar, so the front end has a real
  // skeleton to draw with a message over it.
  if (input.staffCandidates.length === 0) {
    return {
      noQualifiedStaff: true,
      days: dates.map((date) => ({ date, status: 'closed' as const })),
    };
  }

  const paddedDates = [fromDate.subtract({ days: 1 }), ...dates, throughDate.add({ days: 1 })];

  // Expanded once per request — not per day, and never per candidate time,
  // which would be thousands of zone conversions for one page load.
  const businessPeriods = expandOpenPeriods(input.businessHours, paddedDates, timeZone);
  const staffSchedules: StaffDaySchedule[] = input.staffCandidates.map((candidate) => ({
    staffId: candidate.staffId,
    workingPeriods: expandOpenPeriods(candidate.workingHours, paddedDates, timeZone),
    timeOff: candidate.timeOff,
    busyIntervals: candidate.busyIntervals,
  }));

  return {
    noQualifiedStaff: false,
    days: dates.map((date) => computeDay(date, businessPeriods, input, staffSchedules)),
  };
}
