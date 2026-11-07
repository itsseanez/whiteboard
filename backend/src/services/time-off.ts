// Time off, for owners and managers (anyone's) and staff (their own). Nothing
// here checks who may do what: RLS on time_off does, so these queries carry no
// role logic to forget. A staff caller's list holds only their rows, a delete
// of someone else's finds nothing, and an insert for someone else is refused.

import { appPool } from '../db.js';
import { withContext } from '../withContext.js';
import type { TimeOffSpan } from '../lib/time-off-span.js';
import { NotFoundError, type Scope } from './owner.js';

/** RLS refused the insert: a staff caller adding time off for someone else. */
export class TimeOffForbiddenError extends Error {}

/** The caller gave no staff member and has no staff row of their own. */
export class NoStaffGivenError extends Error {}

const RLS_DENIED = '42501';

export interface TimeOffEntry {
  id: string;
  staffId: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

/** Time off that hasn't ended, for staff who aren't archived. */
export async function listTimeOff(scope: Scope, now: Date): Promise<TimeOffEntry[]> {
  return withContext(appPool, scope, async (client) => {
    const { rows } = await client.query<{ id: string; staffId: string; staffName: string; startsAt: Date; endsAt: Date; reason: string | null }>(
      `SELECT t.id, t.staff_id AS "staffId", s.name AS "staffName",
              t.starts_at AS "startsAt", t.ends_at AS "endsAt", t.reason
       FROM time_off t JOIN staff s ON s.id = t.staff_id
       WHERE t.ends_at > $1 AND s.archived_at IS NULL
       ORDER BY t.starts_at, s.name`,
      [now],
    );
    return rows.map((r) => ({ ...r, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString() }));
  });
}

export interface AddedTimeOff {
  id: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
  /** Booked appointments inside it. They stay booked; someone has to move them. */
  overlappingAppointments: number;
}

export async function addTimeOff(
  scope: Scope,
  staffId: string | null,
  span: TimeOffSpan,
  reason: string | null,
): Promise<AddedTimeOff> {
  return withContext(appPool, scope, async (client) => {
    const forStaff =
      staffId ?? (await client.query<{ id: string | null }>('SELECT app_caller_staff_id() AS id')).rows[0]?.id ?? null;
    if (!forStaff) throw new NoStaffGivenError();

    const found = await client.query('SELECT 1 FROM staff WHERE id = $1 AND archived_at IS NULL', [forStaff]);
    if (found.rowCount === 0) throw new NotFoundError();

    const startsAt = new Date(span.startsAt.epochMilliseconds);
    const endsAt = new Date(span.endsAt.epochMilliseconds);
    let id: string;
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO time_off (staff_id, tenant_id, starts_at, ends_at, reason)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [forStaff, scope.tenantId, startsAt, endsAt, reason],
      );
      id = rows[0]!.id;
    } catch (error) {
      if ((error as { code?: string }).code === RLS_DENIED) throw new TimeOffForbiddenError();
      throw error;
    }

    const { rows } = await client.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM appointment
       WHERE staff_id = $1 AND status = 'BOOKED' AND starts_at < $3 AND ends_at > $2`,
      [forStaff, startsAt, endsAt],
    );
    return {
      id,
      staffId: forStaff,
      startsAt: span.startsAt.toString(),
      endsAt: span.endsAt.toString(),
      overlappingAppointments: rows[0]?.count ?? 0,
    };
  });
}

export async function removeTimeOff(scope: Scope, id: string): Promise<void> {
  await withContext(appPool, scope, async (client) => {
    const { rowCount } = await client.query('DELETE FROM time_off WHERE id = $1', [id]);
    if (rowCount === 0) throw new NotFoundError();
  });
}
