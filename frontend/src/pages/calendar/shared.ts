// Grid sizes, view and panel types, and error wording shared by the calendar's parts.

import { ApiError, type CalendarAppointment } from '@/lib/api';

export const STEP = 15; // minutes per row
export const ROW = 20; // px per row

export type View = 'day' | 'week';

export type Panel =
  | { kind: 'appointment'; appointment: CalendarAppointment }
  | { kind: 'reasons'; time: string; lines: string[] }
  | { kind: 'book'; staffId: string; startsAt: string };

const MESSAGES: Record<string, string> = {
  slot_taken: 'Someone else just took that time. Pick another.',
  slot_not_available: "That time isn't bookable any more. Pick another.",
  already_started: 'That appointment has already started.',
  not_booked: 'That appointment was already changed. Reload the calendar.',
  appointment_not_found: 'That appointment no longer exists. Reload the calendar.',
  owner_only: "Only an owner can erase a customer's details.",
  has_future_appointments: 'This customer has an upcoming booking. Cancel it first, then erase their details.',
};

export function messageFor(error: unknown): string {
  if (error instanceof ApiError) return MESSAGES[error.code] ?? error.code;
  return "Can't reach Whiteboard. Check your connection and try again.";
}
