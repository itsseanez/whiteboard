// Builders for the engine's inputs. The engine takes one big object, so without
// these every test spends ten lines on scaffolding before it says anything.
//
// `zoned()` is the one that matters: it turns a local wall-clock time in a zone
// into the exact moment, so assertions read in the same vocabulary a salon
// owner uses ("09:00 on the 25th") instead of in UTC.

import type {
  AvailabilityInput,
  BusyInterval,
  ExcludedTime,
  Interval,
  ResourceCandidate,
  Slot,
  StaffCandidate,
  StaffReason,
  TenantReason,
  TimeZone,
  WeekdayHours,
} from '../../src/availability/types.js';
import { isStaffReasons, type StaffDaySchedule } from '../../src/availability/engine.js';

export const VIENNA = 'Europe/Vienna';
export const NEW_YORK = 'America/New_York';
export const KOLKATA = 'Asia/Kolkata'; // +05:30, never shifts
export const UTC = 'UTC';

// Transition dates used throughout. Both regions always shift on a Sunday.
//   EU: last Sunday of March and October  -> 2026-03-29, 2026-10-25
//   US: second Sunday of March, first of November -> 2026-03-08, 2026-11-01
export const EU_SPRING = '2026-03-29';
export const EU_FALL = '2026-10-25';
export const US_FALL = '2026-11-01';

export function date(iso: string): Temporal.PlainDate {
  return Temporal.PlainDate.from(iso);
}

export function time(hhmm: string): Temporal.PlainTime {
  return Temporal.PlainTime.from(hhmm);
}

export function instant(iso: string): Temporal.Instant {
  return Temporal.Instant.from(iso);
}

export function minutes(n: number): Temporal.Duration {
  return Temporal.Duration.from({ minutes: n });
}

/** A local wall-clock time on a date in a zone, as the exact moment it is. */
export function zoned(isoDate: string, hhmm: string, timeZone: TimeZone = VIENNA): Temporal.Instant {
  return date(isoDate).toPlainDateTime(time(hhmm)).toZonedDateTime(timeZone).toInstant();
}

export function rule(weekday: WeekdayHours['weekday'], start: string, end: string): WeekdayHours {
  return { weekday, startTime: time(start), endTime: time(end) };
}

/** The same hours on all seven days — the usual "it is just open" fixture. */
export function everyDay(start: string, end: string): WeekdayHours[] {
  return ([1, 2, 3, 4, 5, 6, 7] as const).map((weekday) => rule(weekday, start, end));
}

export function weekdaysOnly(start: string, end: string): WeekdayHours[] {
  return ([1, 2, 3, 4, 5] as const).map((weekday) => rule(weekday, start, end));
}

export function interval(start: Temporal.Instant, end: Temporal.Instant): Interval {
  return { startsAt: start, endsAt: end };
}

export function busy(
  appointmentId: string,
  start: Temporal.Instant,
  end: Temporal.Instant,
): BusyInterval {
  return { appointmentId, startsAt: start, endsAt: end };
}

export function staff(
  staffId: string,
  overrides: Partial<Omit<StaffCandidate, 'staffId'>> = {},
): StaffCandidate {
  return {
    staffId,
    workingHours: overrides.workingHours ?? everyDay('09:00', '17:00'),
    timeOff: overrides.timeOff ?? [],
    busyIntervals: overrides.busyIntervals ?? [],
  };
}

export function resource(
  resourceId: string,
  busyIntervals: readonly BusyInterval[] = [],
): ResourceCandidate {
  return { resourceId, busyIntervals };
}

/** For evaluateGridTime, which takes schedules already expanded into moments. */
export function schedule(
  staffId: string,
  overrides: Partial<Omit<StaffDaySchedule, 'staffId'>> = {},
): StaffDaySchedule {
  return {
    staffId,
    workingPeriods: overrides.workingPeriods ?? [],
    timeOff: overrides.timeOff ?? [],
    busyIntervals: overrides.busyIntervals ?? [],
  };
}

export function service(
  overrides: Partial<AvailabilityInput['service']> = {},
): AvailabilityInput['service'] {
  return {
    duration: overrides.duration ?? minutes(60),
    beforeBuffer: overrides.beforeBuffer ?? minutes(0),
    afterBuffer: overrides.afterBuffer ?? minutes(0),
    minimumNotice: overrides.minimumNotice ?? minutes(0),
  };
}

export interface InputOverrides {
  timeZone?: TimeZone;
  now?: Temporal.Instant;
  fromDate?: string;
  throughDate?: string;
  service?: Partial<AvailabilityInput['service']>;
  businessHours?: readonly WeekdayHours[];
  staffCandidates?: readonly StaffCandidate[];
  resourceCandidates?: readonly ResourceCandidate[];
}

/**
 * A complete AvailabilityInput with sane defaults: one stylist working the same
 * hours the business opens, a 60-minute service, no buffers, no notice, nothing
 * booked. `now` sits well before the range so nothing is 'tooSoon' by accident.
 */
export function input(overrides: InputOverrides = {}): AvailabilityInput {
  const timeZone = overrides.timeZone ?? VIENNA;
  const fromDate = overrides.fromDate ?? '2026-06-15';
  return {
    request: {
      timeZone,
      now: overrides.now ?? instant('2026-01-01T00:00:00Z'),
      fromDate: date(fromDate),
      throughDate: date(overrides.throughDate ?? fromDate),
    },
    service: service(overrides.service),
    businessHours: overrides.businessHours ?? everyDay('09:00', '17:00'),
    staffCandidates: overrides.staffCandidates ?? [staff('s1')],
    resourceCandidates: overrides.resourceCandidates ?? [],
  };
}

/** "09:00" for each moment, on the business's clock. How slots get asserted. */
export function localTimes(
  instants: readonly Temporal.Instant[],
  timeZone: TimeZone = VIENNA,
): string[] {
  return instants.map((i) => i.toZonedDateTimeISO(timeZone).toPlainTime().toString().slice(0, 5));
}

/** Elapsed hours between an interval's endpoints — real time, not wall time. */
export function elapsedHours(span: Interval): number {
  return span.endsAt.since(span.startsAt).total('hours');
}

// ---------------------------------------------------------------------------
// Narrowing a verdict
//
// evaluateGridTime returns Slot | ExcludedTime, and ExcludedTime.reason is
// itself a union. These three throw with a useful message instead of letting an
// assertion fail on `undefined`, which is how you end up debugging the test
// rather than the code.
// ---------------------------------------------------------------------------

export function expectSlot(verdict: Slot | ExcludedTime): Slot {
  if (!('staffIds' in verdict)) {
    throw new Error(`expected a Slot, got excluded: ${JSON.stringify(verdict.reason)}`);
  }
  return verdict;
}

export function expectExcluded(verdict: Slot | ExcludedTime): ExcludedTime {
  if ('staffIds' in verdict) {
    throw new Error(`expected an ExcludedTime, got a bookable slot`);
  }
  return verdict;
}

/** The complete per-staff reason set, or a throw if the refusal was tenant-wide. */
export function expectStaffReasons(verdict: Slot | ExcludedTime): readonly StaffReason[] {
  const { reason } = expectExcluded(verdict);
  if (!isStaffReasons(reason)) {
    throw new Error(`expected per-staff reasons, got tenant reason '${reason.reason}'`);
  }
  return reason;
}

/** The one tenant-wide reason, or a throw if the refusal was per-staff. */
export function expectTenantReason(verdict: Slot | ExcludedTime): TenantReason {
  const { reason } = expectExcluded(verdict);
  if (isStaffReasons(reason)) {
    throw new Error(
      `expected a tenant reason, got per-staff: ${reason.map((r) => r.reason).join(', ')}`,
    );
  }
  return reason;
}
