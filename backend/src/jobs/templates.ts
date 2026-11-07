// Emails composed by the worker from a job's data: notices to staff and
// reminders to customers. Customer emails written in a request arrive ready.

import { appUrl, type Mail } from '../lib/mailer.js';

function when(iso: string, timeZone: string): string {
  const local = new Date(iso).toLocaleString('en-US', { timeZone, dateStyle: 'full', timeStyle: 'short' });
  return `${local} (${timeZone})`;
}

export interface StaffNotice {
  to: string;
  notice: 'booked' | 'moved' | 'cancelled';
  organization: string;
  slug: string;
  timeZone: string;
  service: string;
  customer: string;
  startsAt: string;
  previousStartsAt: string | null;
}

export function staffNotice(d: StaffNotice): Mail {
  const at = when(d.startsAt, d.timeZone);
  const week = `Your week: ${appUrl(`/manage/${d.slug}/me`)}`;
  switch (d.notice) {
    case 'booked':
      return { to: d.to, subject: `New booking: ${d.service}, ${at}`, text: `${d.customer} booked ${d.service} with you on ${at}.\n\n${week}` };
    case 'moved':
      return {
        to: d.to,
        subject: `Moved: ${d.service} with ${d.customer}`,
        text: `${d.customer}'s ${d.service} moved${d.previousStartsAt ? ` from ${when(d.previousStartsAt, d.timeZone)}` : ''} to ${at}.\n\n${week}`,
      };
    case 'cancelled':
      return { to: d.to, subject: `Cancelled: ${d.service} with ${d.customer}`, text: `${d.customer} cancelled ${d.service} on ${at}.\n\n${week}` };
  }
}

export interface Reminder {
  to: string;
  customer: string;
  organization: string;
  slug: string;
  timeZone: string;
  service: string;
  staff: string | null;
  startsAt: string;
}

/** No manage link: only its hash is stored, so the reminder points at the confirmation. */
export function reminder(d: Reminder): Mail {
  return {
    to: d.to,
    subject: `Reminder: ${d.service} at ${d.organization} tomorrow`,
    text:
      `Hi ${d.customer}, a reminder of your ${d.service}${d.staff ? ` with ${d.staff}` : ''} at ${d.organization} on ` +
      `${when(d.startsAt, d.timeZone)}.\n\nTo change or cancel, use the link in your confirmation email.\n\n` +
      `${d.organization}, booked through Whiteboard.`,
  };
}

export interface TimeOffNotice {
  to: string;
  decision: 'approved' | 'declined';
  organization: string;
  slug: string;
  timeZone: string;
  startsAt: string;
  endsAt: string;
}

export function timeOffNotice(d: TimeOffNotice): Mail {
  const span = `${when(d.startsAt, d.timeZone)} to ${when(d.endsAt, d.timeZone)}`;
  return {
    to: d.to,
    subject: `Time off ${d.decision} at ${d.organization}`,
    text:
      d.decision === 'approved'
        ? `Your time off from ${span} is approved. You won't be booked then.\n\nYour week: ${appUrl(`/manage/${d.slug}/me`)}`
        : `Your time off request from ${span} was declined. You can still be booked then; talk to your manager if that's a problem.\n\nYour week: ${appUrl(`/manage/${d.slug}/me`)}`,
  };
}
