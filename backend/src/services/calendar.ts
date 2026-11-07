// What the owner calendar draws for a range of the organization's dates:
// staff with their weekly hours, business hours, time off and appointments.
// Instants go out as ISO strings; the browser formats them in the tenant zone.

import { appPool } from '../db.js';
import { withContext } from '../withContext.js';
import { toHHMM, type HoursRange } from '../lib/weekly-hours.js';
import type { Scope } from './owner.js';

export interface CalendarAppointment {
  id: string;
  staffId: string | null;
  serviceId: string;
  serviceName: string;
  resourceId: string | null;
  resourceName: string | null;
  startsAt: string;
  endsAt: string;
  customer: { name: string; email: string; phone: string | null };
}

export interface CalendarData {
  timeZone: string;
  staff: { id: string; name: string; archived: boolean; hours: HoursRange[] }[];
  businessHours: HoursRange[];
  timeOff: { staffId: string; startsAt: string; endsAt: string; reason: string | null }[];
  appointments: CalendarAppointment[];
}

/** Midnight at the start of `from` to midnight after `through`, in the tenant's zone. */
export function rangeInstants(timeZone: string, from: string, through: string) {
  const start = Temporal.PlainDate.from(from).toZonedDateTime(timeZone).toInstant();
  const end = Temporal.PlainDate.from(through).add({ days: 1 }).toZonedDateTime(timeZone).toInstant();
  return { start: new Date(start.epochMilliseconds), end: new Date(end.epochMilliseconds) };
}

const iso = (d: Date) => d.toISOString();

export function getCalendar(scope: Scope, timeZone: string, from: string, through: string): Promise<CalendarData> {
  const { start, end } = rangeInstants(timeZone, from, through);
  return withContext(appPool, scope, async (client) => {
    // Archived staff appear only on days where they still have (past) appointments.
    const staff = await client.query<{ id: string; name: string; archived: boolean }>(
      `SELECT id, name, archived_at IS NOT NULL AS archived FROM staff
       WHERE archived_at IS NULL
          OR id IN (SELECT staff_id FROM appointment WHERE status = 'BOOKED' AND starts_at < $2 AND ends_at > $1)
       ORDER BY created_at, name`,
      [start, end],
    );
    const hours = await client.query<{ staffId: string; weekday: number; start: string; end: string }>(
      `SELECT staff_id AS "staffId", weekday, start_time AS start, end_time AS "end"
       FROM staff_working_hours ORDER BY weekday, start_time`,
    );
    const business = await client.query<{ weekday: number; start: string; end: string }>(
      'SELECT weekday, opens_at AS start, closes_at AS "end" FROM business_hours ORDER BY weekday, opens_at',
    );
    const timeOff = await client.query<{ staffId: string; startsAt: Date; endsAt: Date; reason: string | null }>(
      `SELECT staff_id AS "staffId", starts_at AS "startsAt", ends_at AS "endsAt", reason
       FROM time_off WHERE status = 'approved' AND starts_at < $2 AND ends_at > $1 ORDER BY starts_at`,
      [start, end],
    );
    const appointments = await client.query<{
      id: string;
      staffId: string | null;
      serviceId: string;
      serviceName: string;
      resourceId: string | null;
      resourceName: string | null;
      startsAt: Date;
      endsAt: Date;
      customerName: string;
      customerEmail: string;
      customerPhone: string | null;
    }>(
      `SELECT a.id, a.staff_id AS "staffId", a.service_id AS "serviceId", s.name AS "serviceName",
              a.resource_id AS "resourceId", r.name AS "resourceName",
              a.starts_at AS "startsAt", a.ends_at AS "endsAt",
              c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone"
       FROM appointment a
       JOIN service s ON s.id = a.service_id
       JOIN customer c ON c.id = a.customer_id
       LEFT JOIN resource r ON r.id = a.resource_id
       WHERE a.status = 'BOOKED' AND a.starts_at < $2 AND a.ends_at > $1
       ORDER BY a.starts_at`,
      [start, end],
    );

    const toRange = (r: { weekday: number; start: string; end: string }) => ({
      weekday: r.weekday,
      start: toHHMM(r.start),
      end: toHHMM(r.end),
    });

    return {
      timeZone,
      staff: staff.rows.map((s) => ({
        ...s,
        hours: hours.rows.filter((h) => h.staffId === s.id).map(toRange),
      })),
      businessHours: business.rows.map(toRange),
      timeOff: timeOff.rows.map((t) => ({ staffId: t.staffId, startsAt: iso(t.startsAt), endsAt: iso(t.endsAt), reason: t.reason })),
      appointments: appointments.rows.map((a) => ({
        id: a.id,
        staffId: a.staffId,
        serviceId: a.serviceId,
        serviceName: a.serviceName,
        resourceId: a.resourceId,
        resourceName: a.resourceName,
        startsAt: iso(a.startsAt),
        endsAt: iso(a.endsAt),
        customer: { name: a.customerName, email: a.customerEmail, phone: a.customerPhone },
      })),
    };
  });
}
