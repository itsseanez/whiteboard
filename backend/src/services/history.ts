// An appointment's history, from appointment_event, which only the database
// writes. RLS limits it to owners and managers of the tenant.

import { appPool } from '../db.js';
import { allMembers } from './people.js';
import { withContext } from '../withContext.js';
import { NotFoundError, type Scope } from './owner.js';

export type Actor =
  | { kind: 'customer' }
  | { kind: 'member'; name: string }
  | { kind: 'unknown' }; // before history was kept, or someone since deleted

export interface HistoryEvent {
  kind: 'booked' | 'moved' | 'status';
  at: string;
  actor: Actor;
  staffName: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: string | null;
  previousStaffName: string | null;
  previousStartsAt: string | null;
  previousEndsAt: string | null;
  previousStatus: string | null;
}

interface Row {
  kind: HistoryEvent['kind'];
  at: Date;
  actorUserId: string | null;
  beforeHistory: boolean;
  staffName: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string | null;
  previousStaffName: string | null;
  previousStartsAt: Date | null;
  previousEndsAt: Date | null;
  previousStatus: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function appointmentHistory(
  scope: Scope,
  organizationId: string,
  appointmentId: string,
  headers: Headers,
): Promise<HistoryEvent[]> {
  const rows = await withContext(appPool, scope, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT e.kind, e.at, e.actor_user_id AS "actorUserId", e.before_history AS "beforeHistory",
              s.name AS "staffName", e.starts_at AS "startsAt", e.ends_at AS "endsAt", e.status,
              p.name AS "previousStaffName", e.previous_starts_at AS "previousStartsAt",
              e.previous_ends_at AS "previousEndsAt", e.previous_status AS "previousStatus"
       FROM appointment_event e
       LEFT JOIN staff s ON s.id = e.staff_id
       LEFT JOIN staff p ON p.id = e.previous_staff_id
       WHERE e.appointment_id = $1
       ORDER BY e.at, e.id`,
      [appointmentId],
    );
    return rows;
  });
  // Every appointment has at least its booking line, so none means not yours.
  if (rows.length === 0) throw new NotFoundError();

  const members = await allMembers(organizationId, headers);
  const names = new Map(members.map((m) => [m.userId, m.user.name]));

  return rows.map((r) => {
    const name = r.actorUserId ? names.get(r.actorUserId) : undefined;
    const actor: Actor = r.beforeHistory
      ? { kind: 'unknown' }
      : r.actorUserId === null
        ? { kind: 'customer' }
        : name
          ? { kind: 'member', name }
          : { kind: 'unknown' };
    return {
      kind: r.kind,
      at: r.at.toISOString(),
      actor,
      staffName: r.staffName,
      startsAt: iso(r.startsAt),
      endsAt: iso(r.endsAt),
      status: r.status,
      previousStaffName: r.previousStaffName,
      previousStartsAt: iso(r.previousStartsAt),
      previousEndsAt: iso(r.previousEndsAt),
      previousStatus: r.previousStatus,
    };
  });
}
