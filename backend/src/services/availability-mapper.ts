// The boundary between pg's values and the engine's vocabulary — the only
// place a JS Date or a "09:00:00" string becomes a Temporal value.
//
// It does no time *reasoning*. Expanding a wall-clock rule onto a date in a
// zone is the engine's job; this is grouping and format conversion.
//
// Imports no pool and no pg runtime, only types, so its tests need no
// database.

import type {
  AvailabilityInput,
  BusyInterval,
  Interval,
  ResourceCandidate,
  StaffCandidate,
  WeekdayHours,
} from '../availability/types.js';
import type { AvailabilityQuery, AvailabilityRows, HoursRow } from './availability.js';

// ---------------------------------------------------------------------------
// Value conversions
// ---------------------------------------------------------------------------

/**
 * pg returns timestamptz as a JS Date. Both are absolute moments, so this is
 * exact — except that Postgres stores microseconds and Date holds only
 * milliseconds. Irrelevant at appointment granularity, but it is a lossy step.
 */
function toInstant(value: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

function toInterval(row: { startsAt: Date; endsAt: Date }): Interval {
  return { startsAt: toInstant(row.startsAt), endsAt: toInstant(row.endsAt) };
}

/**
 * appointment.starts_at/ends_at already INCLUDE the buffers, so nothing is
 * widened here — the stored range is the blocked range.
 */
function toBusyInterval(row: { id: string; startsAt: Date; endsAt: Date }): BusyInterval {
  return {
    appointmentId: row.id,
    startsAt: toInstant(row.startsAt),
    endsAt: toInstant(row.endsAt),
  };
}

/**
 * pg returns `time` columns as "HH:mm:ss" strings, which PlainTime parses
 * directly. Worth confirming once in a REPL — if it ever returns something
 * else, PlainTime.from throws rather than producing a wrong value.
 *
 * `weekday` is cast rather than validated: the CHECK on both hours tables
 * already restricts it to 1–7, so a bad value would mean the database was
 * edited outside migrations.
 *
 * An endTime of "00:00:00" is the end-of-day sentinel. It passes through
 * unchanged; interpreting it is the engine's job.
 */
function toWeekdayHours(row: HoursRow): WeekdayHours {
  return {
    weekday: row.weekday as WeekdayHours['weekday'],
    startTime: Temporal.PlainTime.from(row.startTime),
    endTime: Temporal.PlainTime.from(row.endTime),
  };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * One pass per collection instead of a filter inside each candidate loop.
 * Rows with a null key are skipped: an appointment may have no staff member
 * or no resource.
 */
function groupBy<T>(items: readonly T[], key: (item: T) => string | null): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    const existing = groups.get(k);
    if (existing) existing.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function toEngineInput(rows: AvailabilityRows, query: AvailabilityQuery): AvailabilityInput {
  const hoursByStaff = groupBy(rows.staffHours, (h) => h.staffId);
  const timeOffByStaff = groupBy(rows.timeOff, (t) => t.staffId);
  const appointmentsByStaff = groupBy(rows.appointments, (a) => a.staffId);
  const appointmentsByResource = groupBy(rows.appointments, (a) => a.resourceId);

  // An appointment occupying both a staff member and a resource appears in
  // both maps. That is one fact indexed two ways, not duplication — it is what
  // lets the engine report "every stylist is busy" separately from "every
  // station is taken".

  // Every candidate gets an entry even when all three lists are empty. A
  // stylist with no working hours is never available, which is a different
  // fact from a stylist who does not exist, and the reasons output has to be
  // able to say so.
  const staffCandidates: StaffCandidate[] = rows.staffIds.map((staffId) => ({
    staffId,
    workingHours: (hoursByStaff.get(staffId) ?? []).map(toWeekdayHours),
    timeOff: (timeOffByStaff.get(staffId) ?? []).map(toInterval),
    busyIntervals: (appointmentsByStaff.get(staffId) ?? []).map(toBusyInterval),
  }));

  const resourceCandidates: ResourceCandidate[] = rows.resourceIds.map((resourceId) => ({
    resourceId,
    busyIntervals: (appointmentsByResource.get(resourceId) ?? []).map(toBusyInterval),
  }));

  return {
    request: {
      timeZone: query.timeZone,
      now: toInstant(query.now),
      // Throws RangeError on a malformed date. Runs outside the transaction,
      // but it is still a 500 unless the controller validates first.
      fromDate: Temporal.PlainDate.from(query.fromDate),
      throughDate: Temporal.PlainDate.from(query.throughDate),
    },
    service: {
      duration: Temporal.Duration.from({ minutes: rows.service.durationMinutes }),
      beforeBuffer: Temporal.Duration.from({ minutes: rows.service.bufferBeforeMinutes }),
      afterBuffer: Temporal.Duration.from({ minutes: rows.service.bufferAfterMinutes }),
      minimumNotice: Temporal.Duration.from({ minutes: rows.service.minimumNoticeMinutes }),
    },
    businessHours: rows.businessHours.map(toWeekdayHours),
    staffCandidates,
    resourceCandidates,
  };
}
