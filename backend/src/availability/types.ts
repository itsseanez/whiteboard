export type TimeZone = string;

// [start, end)
export interface Interval {
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;
}

export interface BusyInterval extends Interval {
  appointmentId: string;
}

export interface WeekdayHours {
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  startTime: Temporal.PlainTime;
  endTime: Temporal.PlainTime; //00:00 is end of day
}

export interface StaffCandidate {
  staffId: string;
  workingHours: readonly WeekdayHours[];
  timeOff: readonly Interval[];
  busyIntervals: readonly BusyInterval[];
}

export interface ResourceCandidate {
  resourceId: string;
  busyIntervals: readonly BusyInterval[];
}

// Output half of src/availability/types.ts — appended after Interval,
// BusyInterval, WeekdayHours, StaffCandidate, ResourceCandidate and
// AvailabilityInput.

/**
 * Why one candidate could not take a particular grid time.
 * These appear only as a complete set — if a time reaches the excluded list,
 * EVERY candidate failed, so the list length equals the candidate count.
 */
export type StaffReason =
  | { readonly reason: 'busy'; readonly staffId: string; readonly busyInterval: BusyInterval }
  | { readonly reason: 'timeOff'; readonly staffId: string; readonly timeOff: Interval }
  // No payload: the explanation is that NO rule covers this time. There may be
  // no rule for the weekday at all, or two with the time falling in the gap of
  // a split shift, so any single rule would be arbitrary.
  | { readonly reason: 'outsideWorkingHours'; readonly staffId: string };

/** Which resource was occupied, and the appointment holding it. */
export interface ResourceConflict {
  readonly resourceId: string;
  readonly busyInterval: BusyInterval;
}

/**
 * Why a grid time is unavailable regardless of which staff member is asked.
 * Evaluated before the per-staff reasons and short-circuits them: if the salon
 * shuts at 17:00, the stylists' schedules are irrelevant.
 */
export type TenantReason =
  // The start is inside business hours but the service would run past closing.
  // Carries the closing instant rather than the WeekdayHours rule, so the
  // consumer never has to re-expand a wall-clock time in the tenant's zone.
  | { readonly reason: 'doesNotFitBeforeClosing'; readonly closesAt: Temporal.Instant }
  | { readonly reason: 'noAvailableResource'; readonly conflicts: readonly ResourceConflict[] }
  | { readonly reason: 'tooSoon'; readonly earliestBookableAt: Temporal.Instant };

/**
 * A grid time inside business hours that is not bookable.
 * `reason` is either one tenant-wide fact, or the complete set of per-staff
 * facts — narrow with Array.isArray().
 */
export interface ExcludedTime {
  readonly startsAt: Temporal.Instant;
  readonly reason: readonly StaffReason[] | TenantReason;
}

/**
 * A bookable start time. One entry per time, listing everyone who could take
 * it — not one entry per (time, staff) pair. The full candidate set is what
 * the parked gap-filling feature needs to score against.
 *
 * Extends Interval so a Slot passes directly into any interval helper, the
 * same way BusyInterval does. Start and end are the SERVICE times the customer
 * sees; the blocked interval that gets stored is wider by the buffers.
 */
export interface Slot extends Interval {
  readonly staffIds: readonly string[];
  readonly resourceIds: readonly string[]; // empty when the service needs none
}

export interface AvailabilityInput {
  request: {
    timeZone: TimeZone;
    now: Temporal.Instant;
    fromDate: Temporal.PlainDate;
    throughDate: Temporal.PlainDate;
  }
  service: {
    duration: Temporal.Duration;
    beforeBuffer: Temporal.Duration;
    afterBuffer: Temporal.Duration;
    minimumNotice: Temporal.Duration;
  }
  businessHours: readonly WeekdayHours[];
  staffCandidates: readonly StaffCandidate[];
  resourceCandidates: readonly ResourceCandidate[];
}


export type AvailabilityDay =
  | {
    readonly date: Temporal.PlainDate;
    readonly status: 'closed';
  }
  | {
    readonly date: Temporal.PlainDate;
    readonly status: 'open';
    readonly slots: readonly Slot[];
    readonly excluded: readonly ExcludedTime[];
  };

export interface AvailabilityResult {
  /** No staff member is qualified for this service. Every day will be empty. */
  readonly noQualifiedStaff: boolean;
  readonly days: readonly AvailabilityDay[];
}

export type ComputeAvailability = (input: AvailabilityInput) => AvailabilityResult;
