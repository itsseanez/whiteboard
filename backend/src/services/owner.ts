// Owner-side reads and writes for staff, resources, services and hours. Every
// query runs through withContext with the tenant id, so RLS scopes it: an id
// from another tenant behaves exactly like one that doesn't exist.

import type { PoolClient } from 'pg';
import { appPool } from '../db.js';
import { withContext } from '../withContext.js';
import { toHHMM, type HoursRange } from '../lib/weekly-hours.js';

export class NotFoundError extends Error {}
/** A staffId or resourceId in a service body that this tenant doesn't have. */
export class UnknownLinkError extends Error {}

const FOREIGN_KEY_VIOLATION = '23503';

function inTenant<T>(tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withContext(appPool, { tenantId }, fn);
}

// --- staff ---------------------------------------------------------------

export interface StaffMember {
  id: string;
  name: string;
  hours: HoursRange[];
}

async function hoursByStaff(client: PoolClient): Promise<Map<string, HoursRange[]>> {
  const { rows } = await client.query<{ staffId: string; weekday: number; start: string; end: string }>(
    `SELECT staff_id AS "staffId", weekday, start_time AS start, end_time AS "end"
     FROM staff_working_hours
     ORDER BY weekday, start_time`,
  );
  const map = new Map<string, HoursRange[]>();
  for (const r of rows) {
    const list = map.get(r.staffId) ?? [];
    list.push({ weekday: r.weekday, start: toHHMM(r.start), end: toHHMM(r.end) });
    map.set(r.staffId, list);
  }
  return map;
}

export function listStaff(tenantId: string): Promise<StaffMember[]> {
  return inTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string; name: string }>(
      'SELECT id, name FROM staff ORDER BY created_at, name',
    );
    const hours = await hoursByStaff(client);
    return rows.map((s) => ({ ...s, hours: hours.get(s.id) ?? [] }));
  });
}

export function createStaff(tenantId: string, name: string): Promise<StaffMember> {
  return inTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string; name: string }>(
      'INSERT INTO staff (tenant_id, name) VALUES ($1, $2) RETURNING id, name',
      [tenantId, name],
    );
    return { ...rows[0]!, hours: [] };
  });
}

export function renameStaff(tenantId: string, staffId: string, name: string): Promise<void> {
  return inTenant(tenantId, async (client) => {
    const { rowCount } = await client.query('UPDATE staff SET name = $2 WHERE id = $1', [staffId, name]);
    if (rowCount === 0) throw new NotFoundError();
  });
}

/** Replaces the whole week in one transaction, so there is never a half-edited week. */
export function replaceStaffHours(tenantId: string, staffId: string, hours: HoursRange[]): Promise<void> {
  return inTenant(tenantId, async (client) => {
    const { rowCount } = await client.query('SELECT 1 FROM staff WHERE id = $1 FOR UPDATE', [staffId]);
    if (rowCount === 0) throw new NotFoundError();
    await client.query('DELETE FROM staff_working_hours WHERE staff_id = $1', [staffId]);
    for (const h of hours) {
      await client.query(
        `INSERT INTO staff_working_hours (staff_id, tenant_id, weekday, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [staffId, tenantId, h.weekday, h.start, h.end],
      );
    }
  });
}

// --- business hours ------------------------------------------------------

export function getBusinessHours(tenantId: string): Promise<HoursRange[]> {
  return inTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ weekday: number; start: string; end: string }>(
      `SELECT weekday, opens_at AS start, closes_at AS "end"
       FROM business_hours ORDER BY weekday, opens_at`,
    );
    return rows.map((r) => ({ weekday: r.weekday, start: toHHMM(r.start), end: toHHMM(r.end) }));
  });
}

export function replaceBusinessHours(tenantId: string, hours: HoursRange[]): Promise<void> {
  return inTenant(tenantId, async (client) => {
    // Serialises two saves for one tenant; the later one replaces the earlier, never merges.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`business_hours:${tenantId}`]);
    await client.query('DELETE FROM business_hours');
    for (const h of hours) {
      await client.query(
        `INSERT INTO business_hours (tenant_id, weekday, opens_at, closes_at) VALUES ($1, $2, $3, $4)`,
        [tenantId, h.weekday, h.start, h.end],
      );
    }
  });
}

// --- resources -----------------------------------------------------------

export interface Resource {
  id: string;
  name: string;
}

export function listResources(tenantId: string): Promise<Resource[]> {
  return inTenant(tenantId, async (client) => {
    const { rows } = await client.query<Resource>('SELECT id, name FROM resource ORDER BY created_at, name');
    return rows;
  });
}

export function createResource(tenantId: string, name: string): Promise<Resource> {
  return inTenant(tenantId, async (client) => {
    const { rows } = await client.query<Resource>(
      'INSERT INTO resource (tenant_id, name) VALUES ($1, $2) RETURNING id, name',
      [tenantId, name],
    );
    return rows[0]!;
  });
}

export function renameResource(tenantId: string, resourceId: string, name: string): Promise<void> {
  return inTenant(tenantId, async (client) => {
    const { rowCount } = await client.query('UPDATE resource SET name = $2 WHERE id = $1', [resourceId, name]);
    if (rowCount === 0) throw new NotFoundError();
  });
}

// --- services ------------------------------------------------------------

export interface ServiceInput {
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  staffIds: string[];
  resourceIds: string[];
}

export interface OwnerService extends ServiceInput {
  id: string;
}

export function listServices(tenantId: string): Promise<OwnerService[]> {
  return inTenant(tenantId, async (client) => {
    const { rows } = await client.query<Omit<OwnerService, 'staffIds' | 'resourceIds'>>(
      `SELECT id, name,
              duration_minutes       AS "durationMinutes",
              buffer_before_minutes  AS "bufferBeforeMinutes",
              buffer_after_minutes   AS "bufferAfterMinutes",
              minimum_notice_minutes AS "minimumNoticeMinutes"
       FROM service ORDER BY created_at, name`,
    );
    const staff = await client.query<{ serviceId: string; id: string }>(
      'SELECT service_id AS "serviceId", staff_id AS id FROM staff_service',
    );
    const resources = await client.query<{ serviceId: string; id: string }>(
      'SELECT service_id AS "serviceId", resource_id AS id FROM service_resource',
    );
    return rows.map((s) => ({
      ...s,
      staffIds: staff.rows.filter((l) => l.serviceId === s.id).map((l) => l.id),
      resourceIds: resources.rows.filter((l) => l.serviceId === s.id).map((l) => l.id),
    }));
  });
}

async function replaceLinks(client: PoolClient, tenantId: string, serviceId: string, input: ServiceInput) {
  await client.query('DELETE FROM staff_service WHERE service_id = $1', [serviceId]);
  await client.query('DELETE FROM service_resource WHERE service_id = $1', [serviceId]);
  try {
    // The composite foreign keys refuse an id from another tenant.
    await client.query(
      `INSERT INTO staff_service (staff_id, service_id, tenant_id)
       SELECT unnest($1::uuid[]), $2, $3`,
      [input.staffIds, serviceId, tenantId],
    );
    await client.query(
      `INSERT INTO service_resource (resource_id, service_id, tenant_id)
       SELECT unnest($1::uuid[]), $2, $3`,
      [input.resourceIds, serviceId, tenantId],
    );
  } catch (err) {
    if ((err as { code?: string }).code === FOREIGN_KEY_VIOLATION) throw new UnknownLinkError();
    throw err;
  }
}

export function createService(tenantId: string, input: ServiceInput): Promise<OwnerService> {
  return inTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO service (tenant_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, minimum_notice_minutes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, input.name, input.durationMinutes, input.bufferBeforeMinutes, input.bufferAfterMinutes, input.minimumNoticeMinutes],
    );
    const id = rows[0]!.id;
    await replaceLinks(client, tenantId, id, input);
    return { id, ...input };
  });
}

export function updateService(tenantId: string, serviceId: string, input: ServiceInput): Promise<OwnerService> {
  return inTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE service SET name = $2, duration_minutes = $3, buffer_before_minutes = $4,
              buffer_after_minutes = $5, minimum_notice_minutes = $6
       WHERE id = $1`,
      [serviceId, input.name, input.durationMinutes, input.bufferBeforeMinutes, input.bufferAfterMinutes, input.minimumNoticeMinutes],
    );
    if (rowCount === 0) throw new NotFoundError();
    await replaceLinks(client, tenantId, serviceId, input);
    return { id: serviceId, ...input };
  });
}
