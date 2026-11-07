// Time off as people say it — "Dec 24 to Dec 26", "Friday 9:00 to 12:00" —
// turned into the two instants the table stores.
//
// Dates and times are wall clock in the organization's zone, never the
// browser's: an owner travelling abroad still means 9:00 at the shop. A missing
// start time means the start of that day; a missing end time, the end of the
// end day (the start of the next one, which isn't always 00:00).
//
// DST boundaries resolve the way working hours do (engine.ts expandRule):
// 'compatible' for the start and 'later' for the end. Both lean toward a longer
// absence, which is the safe direction: an extra blocked hour costs a booking,
// a missing one books someone who isn't there.

export interface TimeOffInput {
  startDate: string;
  startTime?: string | undefined;
  endDate: string;
  endTime?: string | undefined;
  reason?: string | undefined;
}

export interface TimeOffSpan {
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;
}

export type ParsedTimeOff =
  | { ok: true; value: TimeOffInput }
  | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MAX_DAYS = 366;
const MAX_REASON = 200;

function optional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function parseTimeOff(body: unknown): ParsedTimeOff {
  const raw = (body ?? {}) as Record<string, unknown>;
  const startDate = optional(raw.startDate);
  const endDate = optional(raw.endDate) ?? startDate;
  const startTime = optional(raw.startTime);
  const endTime = optional(raw.endTime);
  const reason = optional(raw.reason);

  if (!startDate || !endDate || !DATE.test(startDate) || !DATE.test(endDate)) {
    return { ok: false, error: 'startDate and endDate must be dates (YYYY-MM-DD)' };
  }
  try {
    Temporal.PlainDate.from(startDate, { overflow: 'reject' });
    Temporal.PlainDate.from(endDate, { overflow: 'reject' });
  } catch {
    return { ok: false, error: 'startDate and endDate must be real dates' };
  }
  if ((startTime && !HHMM.test(startTime)) || (endTime && !HHMM.test(endTime))) {
    return { ok: false, error: 'startTime and endTime must be HH:MM' };
  }
  if (reason && reason.length > MAX_REASON) {
    return { ok: false, error: `reason must be ${MAX_REASON} characters or fewer` };
  }
  return { ok: true, value: { startDate, startTime, endDate, endTime, reason } };
}

export type SpanResult = { ok: true; value: TimeOffSpan } | { ok: false; error: string };

export function timeOffSpan(input: TimeOffInput, timeZone: string): SpanResult {
  const startDate = Temporal.PlainDate.from(input.startDate);
  const endDate = Temporal.PlainDate.from(input.endDate);

  if (startDate.until(endDate, { largestUnit: 'day' }).days >= MAX_DAYS) {
    return { ok: false, error: `time off can be at most ${MAX_DAYS} days at once` };
  }

  const startsAt = input.startTime
    ? startDate
      .toPlainDateTime(Temporal.PlainTime.from(input.startTime))
      .toZonedDateTime(timeZone, { disambiguation: 'compatible' })
      .toInstant()
    : startDate.toZonedDateTime(timeZone).toInstant();

  const endsAt = input.endTime
    ? endDate
      .toPlainDateTime(Temporal.PlainTime.from(input.endTime))
      .toZonedDateTime(timeZone, { disambiguation: 'later' })
      .toInstant()
    : endDate.add({ days: 1 }).toZonedDateTime(timeZone).toInstant();

  if (Temporal.Instant.compare(endsAt, startsAt) <= 0) {
    return { ok: false, error: 'time off must end after it starts' };
  }
  return { ok: true, value: { startsAt, endsAt } };
}
