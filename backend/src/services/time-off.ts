// Time off, for owners and managers (anyone's) and staff (their own). Staff
// ask, and owners and managers approve or decline; only approved time off
// blocks availability. RLS on time_off decides who may do what, so these
// queries carry no role logic to forget: a staff caller lists only their rows,
// can't insert anything but their own pending request, can't remove approved
// time off, and can't change a status at all.

import type { PoolClient } from 'pg';
import { appPool } from '../db.js';
import { withContext } from '../withContext.js';
import type { TimeOffSpan } from '../lib/time-off-span.js';
import { NotFoundError, type Scope } from './owner.js';

/** RLS refused the insert: a staff caller adding time off for someone else. */
export class TimeOffForbiddenError extends Error {}

/** The caller gave no staff member and has no staff row of their own. */
export class NoStaffGivenError extends Error {}

/** Approve or decline by someone who can't: RLS let them see it, not change it. */
export class DecideForbiddenError extends Error {}

/** Approve or decline of a request that's already been decided. */
export class AlreadyDecidedError extends Error {}

export type TimeOffStatus = 'pending' | 'approved' | 'declined';

const RLS_DENIED = '42501';

export interface TimeOffEntry {
  id: string;
  staffId: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  status: TimeOffStatus;
}

/** Time off that hasn't ended, for staff who aren't archived. */
export async function listTimeOff(scope: Scope, now: Date): Promise<TimeOffEntry[]> {
  return withContext(appPool, scope, async (client) => {
    const { rows } = await client.query<{ id: string; staffId: string; staffName: string; startsAt: Date; endsAt: Date; reason: string | null; status: TimeOffStatus }>(
      `SELECT t.id, t.staff_id AS "staffId", s.name AS "staffName",
              t.starts_at AS "startsAt", t.ends_at AS "endsAt", t.reason, t.status
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
  /** Approved when an owner or manager adds it; pending when staff ask. */
  status: TimeOffStatus;
  /** Booked appointments inside it. They stay booked; someone has to move them. */
  overlappingAppointments: number;
}

async function overlapping(client: PoolClient, staffId: string, startsAt: Date, endsAt: Date): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM appointment
     WHERE staff_id = $1 AND status = 'BOOKED' AND starts_at < $3 AND ends_at > $2`,
    [staffId, startsAt, endsAt],
  );
  return rows[0]?.count ?? 0;
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
    // What the caller is allowed to ask for; RLS refuses anything else anyway.
    const manages = (await client.query<{ manages: boolean }>('SELECT app_caller_manages() AS manages')).rows[0]?.manages;
    const status: TimeOffStatus = manages ? 'approved' : 'pending';
    let id: string;
    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO time_off (staff_id, tenant_id, starts_at, ends_at, reason, status)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [forStaff, scope.tenantId, startsAt, endsAt, reason, status],
      );
      id = rows[0]!.id;
    } catch (error) {
      if ((error as { code?: string }).code === RLS_DENIED) throw new TimeOffForbiddenError();
      throw error;
    }

    return {
      id,
      staffId: forStaff,
      startsAt: span.startsAt.toString(),
      endsAt: span.endsAt.toString(),
      status,
      overlappingAppointments: await overlapping(client, forStaff, startsAt, endsAt),
    };
  });
}

export async function removeTimeOff(scope: Scope, id: string): Promise<void> {
  await withContext(appPool, scope, async (client) => {
    const { rowCount } = await client.query('DELETE FROM time_off WHERE id = $1', [id]);
    if (rowCount === 0) throw new NotFoundError();
  });
}

/**
 * Approve or decline a pending request. The status check is in the UPDATE, so
 * two managers deciding at once can't both win; the loser is told it's decided.
 */
export async function decideTimeOff(
  scope: Scope,
  id: string,
  status: 'approved' | 'declined',
): Promise<{ status: TimeOffStatus; overlappingAppointments: number }> {
  return withContext(appPool, scope, async (client) => {
    const { rows } = await client.query<{ staffId: string; startsAt: Date; endsAt: Date }>(
      `UPDATE time_off SET status = $2 WHERE id = $1 AND status = 'pending'
       RETURNING staff_id AS "staffId", starts_at AS "startsAt", ends_at AS "endsAt"`,
      [id, status],
    );
    const decided = rows[0];
    if (decided) {
      const count = status === 'approved' ? await overlapping(client, decided.staffId, decided.startsAt, decided.endsAt) : 0;
      return { status, overlappingAppointments: count };
    }
    // Nothing changed: say why, from what this caller can see.
    const seen = await client.query<{ status: TimeOffStatus }>('SELECT status FROM time_off WHERE id = $1', [id]);
    const current = seen.rows[0];
    if (!current) throw new NotFoundError();
    if (current.status !== 'pending') throw new AlreadyDecidedError();
    throw new DecideForbiddenError();
  });
}
