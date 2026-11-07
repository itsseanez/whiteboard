// One appointment history event as a sentence, in the organization's zone.

import type { HistoryEvent } from './api';
import { fullMoment, timeOfDay } from './format';

const STATUS: Record<string, string> = {
  CANCELLED: 'Cancelled',
  COMPLETED: 'Marked as done',
  NO_SHOW: 'Marked as a no-show',
  BOOKED: 'Booked again',
};

function who(event: HistoryEvent): string {
  switch (event.actor.kind) {
    case 'customer':
      return 'by the customer';
    case 'member':
      return `by ${event.actor.name}`;
    default:
      return '';
  }
}

function slot(startsAt: string | null, staff: string | null, timeZone: string): string {
  if (!startsAt) return '';
  return `${fullMoment(startsAt, timeZone)}${staff ? ` with ${staff}` : ''}`;
}

/** 'Moved from Monday 3 February, 09:00 with Ana to 10:00 with Ana' and who did it, plus when. */
export function historyLine(event: HistoryEvent, timeZone: string): { what: string; when: string } {
  let what: string;
  if (event.kind === 'booked') {
    what = `Booked for ${slot(event.startsAt, event.staffName, timeZone)}`;
  } else if (event.kind === 'moved') {
    const sameDay =
      event.previousStartsAt && event.startsAt && fullMoment(event.previousStartsAt, timeZone).split(',')[0] === fullMoment(event.startsAt, timeZone).split(',')[0];
    const to = sameDay && event.startsAt
      ? `${timeOfDay(event.startsAt, timeZone)}${event.staffName ? ` with ${event.staffName}` : ''}`
      : slot(event.startsAt, event.staffName, timeZone);
    what = `Moved from ${slot(event.previousStartsAt, event.previousStaffName, timeZone)} to ${to}`;
  } else {
    what = STATUS[event.status ?? ''] ?? `Status changed to ${event.status}`;
  }
  const by = who(event);
  const unknown = event.actor.kind === 'unknown' ? ' (before history was kept)' : '';
  return { what: by ? `${what} ${by}` : what, when: `${fullMoment(event.at, timeZone)}${unknown}` };
}
