// Turns the engine's structured reasons into sentences an owner can read.
// The API stays structured; wording lives only here. Appointment ids in the
// reasons are matched to the appointments the calendar already loaded.

import type { CalendarAppointment, ExcludedTime, StaffReason, TenantReason } from './api';
import { timeOfDay } from './format';

export interface ReasonContext {
  timeZone: string;
  serviceName: string;
  staffName: (id: string) => string;
  resourceName: (id: string) => string;
  appointment: (id: string) => CalendarAppointment | undefined;
}

function span(startsAt: string, endsAt: string, tz: string): string {
  return `${timeOfDay(startsAt, tz)}–${timeOfDay(endsAt, tz)}`;
}

// The busy interval includes buffers, so it can be wider than the appointment it names.
function heldBy(appointmentId: string, fallback: { startsAt: string; endsAt: string }, ctx: ReasonContext): string {
  const a = ctx.appointment(appointmentId);
  return a
    ? `${a.serviceName}, ${span(a.startsAt, a.endsAt, ctx.timeZone)}`
    : `booked ${span(fallback.startsAt, fallback.endsAt, ctx.timeZone)}`;
}

export function staffSentence(r: StaffReason, ctx: ReasonContext): string {
  const name = ctx.staffName(r.staffId);
  switch (r.reason) {
    case 'outsideWorkingHours':
      return `${name} isn't working then.`;
    case 'timeOff':
      return `${name} is off (${span(r.timeOff.startsAt, r.timeOff.endsAt, ctx.timeZone)}).`;
    case 'busy':
      return `${name} is with a customer (${heldBy(r.busyInterval.appointmentId, r.busyInterval, ctx)}).`;
  }
}

export function tenantSentences(r: TenantReason, ctx: ReasonContext): string[] {
  switch (r.reason) {
    case 'tooSoon':
      return [`Too soon to book. The earliest ${ctx.serviceName} is ${timeOfDay(r.earliestBookableAt, ctx.timeZone)}.`];
    case 'doesNotFitBeforeClosing':
      return [`A ${ctx.serviceName} starting then wouldn't finish before closing at ${timeOfDay(r.closesAt, ctx.timeZone)}.`];
    case 'noAvailableResource':
      return r.conflicts.map(
        (c) => `${ctx.resourceName(c.resourceId)} is in use (${heldBy(c.busyInterval.appointmentId, c.busyInterval, ctx)}).`,
      );
  }
}

/** Every reason for one excluded time, one sentence each. */
export function explain(excluded: ExcludedTime, ctx: ReasonContext): string[] {
  return Array.isArray(excluded.reason)
    ? excluded.reason.map((r) => staffSentence(r, ctx))
    : tenantSentences(excluded.reason, ctx);
}

/** The reasons that apply to one staff member: theirs, or the organization-wide one. */
export function explainFor(staffId: string, excluded: ExcludedTime, ctx: ReasonContext): string[] {
  if (!Array.isArray(excluded.reason)) return tenantSentences(excluded.reason, ctx);
  const mine = excluded.reason.find((r) => r.staffId === staffId);
  return mine ? [staffSentence(mine, ctx)] : [];
}
