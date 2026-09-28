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
};

export interface ResourceCandidate {
  resourceId: string;
  busyIntervals: readonly BusyInterval[];
};
