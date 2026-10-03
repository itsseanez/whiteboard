import type { Pool, PoolClient } from 'pg';
import { withContext } from '../withContext.js';
import { computeQueryWindow } from '../availability/query-window.js';

// ---------------------------------------------------------------------------
// Raw row shapes — what pg hands back, before any Temporal conversion.
// timestamptz arrives as Date, time as a string like "09:00:00".
// Converting them is availability-mapper.ts's job, not this file's.
// ---------------------------------------------------------------------------

export interface ServiceRow {
  id: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
}

export interface HoursRow {
  weekday: number; // Monday = 1, Sunday = 7
  startTime: string; // 'HH:mm:ss' format
  endTime: string; // 'HH:mm:ss' format
}

export interface StaffHoursRow extends HoursRow {
  staffId: string;
}

export interface TimeOffRow {
  staffId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface AppointmentRow {
  id: string;
  // Both nullable in the schema: staff_id for resource-only bookings,
  // resource_id for services that need no resource.
  staffId: string | null;
  resourceId: string | null;
  startsAt: Date;
  endsAt: Date;
}

export interface AvailabilityRows {
  service: ServiceRow;
  staffIds: string[];
  resourceIds: string[];
  businessHours: HoursRow[];
  staffHours: StaffHoursRow[];
  timeOff: TimeOffRow[];
  appointments: AppointmentRow[];
}

export class ServiceNotFoundError extends Error { }

// ---------------------------------------------------------------------------
// Query helpers. Each takes a client, never a pool: the client is already bound
// to a role, so these are identical for public and authenticated callers.
// No WHERE tenant_id — RLS applies that, and writing it again defeats the point.
// ---------------------------------------------------------------------------

async function fetchService(client: PoolClient, serviceId: string): Promise<ServiceRow> {
  const { rows } = await client.query<ServiceRow>(
    `SELECT id,
            duration_minutes        AS "durationMinutes",
            buffer_before_minutes   AS "bufferBeforeMinutes",
            buffer_after_minutes    AS "bufferAfterMinutes",
            minimum_notice_minutes  AS "minimumNoticeMinutes"
     FROM service
     WHERE id = $1`,
    [serviceId],
  );
  const service = rows[0];
  // RLS makes "no such service" and "another tenant's service" identical here —
  // zero rows either way. That is deliberate; it is the same disguised 404 the
  // tenant routes use.
  if (!service) throw new ServiceNotFoundError(serviceId);
  return service;
}

async function fetchCandidateStaffIds(
  client: PoolClient,
  serviceId: string,
  preferredStaffId: string | null,
): Promise<string[]> {
  const { rows } = await client.query<{ staffId: string }>(
    `SELECT staff_id AS "staffId"
     FROM staff_service
     WHERE service_id = $1
       AND ($2::uuid IS NULL OR staff_id = $2)`,
    [serviceId, preferredStaffId],
  );
  return rows.map((r) => r.staffId);
}

async function fetchLinkedResourceIds(client: PoolClient, serviceId: string): Promise<string[]> {
  const { rows } = await client.query<{ resourceId: string }>(
    `SELECT resource_id AS "resourceId"
     FROM service_resource
     WHERE service_id = $1`,
    [serviceId],
  );
  return rows.map((r) => r.resourceId);
}

async function fetchBusinessHours(client: PoolClient): Promise<HoursRow[]> {
  // No window filter: these are weekly patterns, a handful of rows per tenant.
  const { rows } = await client.query<HoursRow>(
    `SELECT weekday,
            opens_at  AS "startTime",
            closes_at AS "endTime"
     FROM business_hours
     ORDER BY weekday, opens_at`,
  );
  return rows;
}

async function fetchStaffHours(client: PoolClient, staffIds: string[]): Promise<StaffHoursRow[]> {
  // One query for every candidate, not one per staff member.
  const { rows } = await client.query<StaffHoursRow>(
    `SELECT staff_id  AS "staffId",
            weekday,
            start_time AS "startTime",
            end_time   AS "endTime"
     FROM staff_working_hours
     WHERE staff_id = ANY($1::uuid[])
     ORDER BY staff_id, weekday, start_time`,
    [staffIds],
  );
  return rows;
}

async function fetchTimeOff(
  client: PoolClient,
  staffIds: string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<TimeOffRow[]> {
  // Overlap, not containment: a holiday that began last week still blocks the
  // first day of this window. Half-open on both sides, matching the [start,end)
  // rule used everywhere else.
  const { rows } = await client.query<TimeOffRow>(
    `SELECT staff_id  AS "staffId",
            starts_at AS "startsAt",
            ends_at   AS "endsAt"
     FROM time_off
     WHERE staff_id = ANY($1::uuid[])
       AND starts_at < $3
       AND ends_at   > $2`,
    [staffIds, windowStart, windowEnd],
  );
  return rows;
}

async function fetchAppointments(
  client: PoolClient,
  staffIds: string[],
  resourceIds: string[],
  windowStart: Date,
  windowEnd: Date,
): Promise<AppointmentRow[]> {
  // An appointment matters if it occupies a candidate staff member OR a linked
  // resource. customer_id and service_id are deliberately not selected.
  const { rows } = await client.query<AppointmentRow>(
    `SELECT id,
            staff_id    AS "staffId",
            resource_id AS "resourceId",
            starts_at   AS "startsAt",
            ends_at     AS "endsAt"
     FROM appointment
     WHERE status = 'BOOKED'
       AND starts_at < $4
       AND ends_at   > $3
       AND (staff_id = ANY($1::uuid[]) OR resource_id = ANY($2::uuid[]))`,
    [staffIds, resourceIds, windowStart, windowEnd],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface AvailabilityQuery {
  tenantId: string;
  timeZone: string; // IANA id from tenant.timezone
  serviceId: string;
  preferredStaffId: string | null;
  fromDate: string; // salon calendar date, "2026-10-25"
  throughDate: string;
  now: Date;
}

export async function fetchAvailabilityRows(
  pool: Pool,
  query: AvailabilityQuery,
): Promise<AvailabilityRows> {
  return withContext(pool, { tenantId: query.tenantId }, async (client) => {
    // Wave 1 — independent of each other, but a single PoolClient is one
    // connection, so node-postgres serializes these anyway. Promise.all would
    // buy nothing.
    const service = await fetchService(client, query.serviceId);

    const spanMinutes =
      service.durationMinutes + service.bufferBeforeMinutes + service.bufferAfterMinutes;
    const { windowStart, windowEnd } = computeQueryWindow(
      query.timeZone,
      query.fromDate,
      query.throughDate,
      spanMinutes,
    );

    const staffIds = await fetchCandidateStaffIds(client, query.serviceId, query.preferredStaffId);
    const resourceIds = await fetchLinkedResourceIds(client, query.serviceId);
    const businessHours = await fetchBusinessHours(client);

    // Wave 2 — needs the id lists from wave 1.
    const staffHours = await fetchStaffHours(client, staffIds);
    const timeOff = await fetchTimeOff(client, staffIds, windowStart, windowEnd);
    const appointments = await fetchAppointments(
      client,
      staffIds,
      resourceIds,
      windowStart,
      windowEnd,
    );

    return { service, staffIds, resourceIds, businessHours, staffHours, timeOff, appointments };
  });
}
