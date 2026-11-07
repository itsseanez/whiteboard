// Emails to the customer about their own appointment: a confirmation with the
// manage link, and a notice when it's cancelled or moved, by them or by the
// business. Sent after the change is committed, and never allowed to undo it:
// a failed or unconfigured send is logged and the booking still stands.

import type { Pool } from 'pg';
import { withContext } from '../withContext.js';
import { appUrl, getMailer, MailNotConfiguredError, type Mail } from '../lib/mailer.js';

export type AppointmentEmail =
  | { kind: 'booked'; manageToken: string }
  | { kind: 'moved' }
  | { kind: 'cancelled' };

interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
}

interface Details {
  email: string;
  serviceName: string;
  staffName: string;
  startsAt: Date;
}

/** Same pool and caller as the change itself, so RLS reads it as that caller. */
async function details(pool: Pool, tenantId: string, userId: string | undefined, appointmentId: string) {
  return withContext(pool, { tenantId, userId }, async (client) => {
    const { rows } = await client.query<Details>(
      `SELECT customer.email, service.name AS "serviceName", staff.name AS "staffName", appointment.starts_at AS "startsAt"
       FROM appointment
       JOIN customer ON customer.id = appointment.customer_id
       JOIN service ON service.id = appointment.service_id
       JOIN staff ON staff.id = appointment.staff_id
       WHERE appointment.id = $1`,
      [appointmentId],
    );
    return rows[0];
  });
}

function when(startsAt: Date, timeZone: string): string {
  const local = startsAt.toLocaleString('en-US', { timeZone, dateStyle: 'full', timeStyle: 'short' });
  return `${local} (${timeZone})`;
}

export function compose(org: Organization, d: Details, email: AppointmentEmail): Mail {
  const sign = `${org.name}, booked through Whiteboard.`;
  const at = when(d.startsAt, org.timezone);
  switch (email.kind) {
    case 'booked':
      return {
        to: d.email,
        subject: `Your appointment at ${org.name}`,
        text:
          `You're booked for ${d.serviceName} with ${d.staffName} on ${at}.\n\n` +
          `To change or cancel: ${appUrl(`/${org.slug}/manage?token=${encodeURIComponent(email.manageToken)}`)}\n\n` +
          `Keep this email. That link is the only way to change this appointment online.\n\n${sign}`,
      };
    case 'moved':
      return {
        to: d.email,
        subject: `Your appointment at ${org.name} has moved`,
        text:
          `Your ${d.serviceName} appointment is now on ${at}, with ${d.staffName}.\n\n` +
          `To change or cancel, use the link in your confirmation email.\n\n${sign}`,
      };
    case 'cancelled':
      return {
        to: d.email,
        subject: `Your appointment at ${org.name} is cancelled`,
        text:
          `Your ${d.serviceName} appointment with ${d.staffName} on ${at} has been cancelled.\n\n` +
          `To book again: ${appUrl(`/${org.slug}`)}\n\n${sign}`,
      };
  }
}

/** Resolves to whether the email went. Never throws. */
export async function emailCustomer(
  pool: Pool,
  org: Organization,
  appointmentId: string,
  email: AppointmentEmail,
  userId?: string,
): Promise<boolean> {
  try {
    const mailer = getMailer();
    const d = await details(pool, org.id, userId, appointmentId);
    if (!d) return false;
    await mailer.send(compose(org, d, email));
    return true;
  } catch (error) {
    if (!(error instanceof MailNotConfiguredError)) {
      console.error(`Appointment email (${email.kind}) for ${appointmentId} failed:`, error);
    }
    return false;
  }
}
