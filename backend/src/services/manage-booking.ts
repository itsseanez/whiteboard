// src/services/manage-booking.ts
//
// Cancel and reschedule, both authorized by the manage token alone.
//
// AUTHORIZATION
//
// There is no customer login, so the token IS the authorization. It is looked
// up by hash, and the lookup is the permission check — there is no separate
// "does this person own this appointment" step to forget, because a row that
// does not match the token is never fetched. RLS narrows it further to the
// tenant in the URL, so a token from another salon finds nothing here.
//
// WHY RESCHEDULE IS AN UPDATE AND NOT CANCEL-THEN-REBOOK
//
// Rescheduling in place keeps the appointment id and the manage token stable,
// which is what makes a second reschedule from the same email link work. The
// cost is that the row no longer records where it used to be — acceptable
// because the audit trail is the thing that should answer that question, and a
// cancel-then-insert would also kill the customer's link and hand them a new
// one they never received.
//
// WHY THE EXCLUSION CONSTRAINT STILL COVERS IT
//
// Verified against Postgres rather than assumed:
//
//   · An UPDATE moving a row's blocked range onto its OWN old range is
//     accepted. An exclusion constraint compares a row against other rows.
//   · An UPDATE moving it onto ANOTHER row's range blocks until that row's
//     transaction commits, then fails with 23P01 — identical to an INSERT.
//
// So reschedule needs no new concurrency machinery, and the two-step
// check-then-write shape is safe here for exactly the reason it is safe in
// createBooking: the check produces good error messages, the constraint
// produces correctness.
//
// WHAT RESCHEDULE RE-READS RATHER THAN PRESERVES
//
// Duration and buffers come from the service row as it stands now, exactly as
// a new booking would — not from the old appointment's stored spans. The
// snapshot rule in the no-overlap migration exists so that editing a service
// cannot retroactively move appointments nobody touched; a reschedule is
// someone touching this one. Preserving the old duration would be worse: the
// availability check validated a slot of the CURRENT service length, so
// storing a different length would store a range nothing checked.
//
// WHAT IS DELIBERATELY NOT HERE
//
// A cancellation window. service.minimum_notice_minutes governs how soon a
// NEW booking may be made, and reschedule inherits it for the new time because
// it runs the same availability check. There is no rule about how close to an
// appointment a customer may cancel, because that is a cancellation policy —
// its own product concept, its own column, and its own owner-facing setting.
// The asymmetry this leaves is real and intended: you cannot reschedule INTO
// the next thirty minutes, but you can cancel one minute before.

import type { Pool, PoolClient } from 'pg';
import { withContext } from '../withContext.js';
import { ServiceNotFoundError } from './availability.js';
import {
  SlotNotOfferedError,
  SlotTakenError,
  requireOfferedSlot,
  type SlotRequest,
} from './booking.js';
import { hashManageToken } from './manage-token.js';

/** No appointment matches this token in this tenant. Becomes a 404. */
export class AppointmentNotFoundError extends Error {}

/**
 * The appointment exists but is not in a state this operation accepts —
 * already completed, marked a no-show, or already begun. Becomes a 409.
 */
export class AppointmentNotManageableError extends Error {
  constructor(readonly reason: 'already_started' | 'not_booked') {
    super(reason);
  }
}

interface AppointmentRow {
  id: string;
  serviceId: string;
  staffId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

export interface CancelRequest {
  tenantId: string;
  token: string;
  now: Date;
}

export interface CancelResult {
  appointmentId: string;
  /** True when this call changed the row; false when it was already cancelled. */
  cancelled: boolean;
}

export interface RescheduleRequest {
  tenantId: string;
  timeZone: string;
  token: string;
  startsAt: Temporal.Instant;
  /**
   * Move to a different stylist at the same time, or null to keep the one the
   * appointment already has. A customer who picked Anna gets Anna unless they
   * say otherwise — silently reassigning them because Anna is busy at the new
   * time would be a surprise, not a convenience.
   */
  staffId: string | null;
  now: Date;
}

export interface RescheduleResult {
  appointmentId: string;
  staffId: string;
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;
}

function isExclusionViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23P01'
  );
}

/**
 * The appointment a token names, or null.
 *
 * No tenant_id in the WHERE clause — RLS applies it. The token is globally
 * unique, so the tenant filter is what makes a valid token from another salon
 * behave exactly like a wrong one.
 */
async function fetchByToken(client: PoolClient, token: string): Promise<AppointmentRow | null> {
  const { rows } = await client.query<AppointmentRow>(
    `SELECT id,
            service_id AS "serviceId",
            staff_id   AS "staffId",
            starts_at  AS "startsAt",
            ends_at    AS "endsAt",
            status
     FROM appointment
     WHERE manage_token_hash = $1`,
    [hashManageToken(token)],
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelBooking(pool: Pool, request: CancelRequest): Promise<CancelResult> {
  return withContext(pool, { tenantId: request.tenantId }, async (client) => {
    const appointment = await fetchByToken(client, request.token);
    if (!appointment) throw new AppointmentNotFoundError();

    // Idempotent, and only for CANCELLED. A customer clicking the same link in
    // the same email twice is the ordinary case, and a 409 there reads as "your
    // cancellation failed" when it did not. COMPLETED and NO_SHOW are different
    // — the appointment happened — so those stay a conflict.
    if (appointment.status === 'CANCELLED') {
      return { appointmentId: appointment.id, cancelled: false };
    }
    if (appointment.status !== 'BOOKED') {
      throw new AppointmentNotManageableError('not_booked');
    }
    // A customer may not retroactively cancel a visit they have already had or
    // missed; marking it COMPLETED or NO_SHOW is the owner's call.
    if (appointment.startsAt.getTime() <= request.now.getTime()) {
      throw new AppointmentNotManageableError('already_started');
    }

    // Re-checks the status in the WHERE clause rather than trusting the read
    // above. Same transaction, so nothing can have changed it — but this is the
    // statement that matters, and it costs nothing to make it say so itself.
    const { rowCount } = await client.query(
      `UPDATE appointment
       SET status = 'CANCELLED'
       WHERE id = $1 AND status = 'BOOKED'`,
      [appointment.id],
    );
    if (rowCount !== 1) throw new AppointmentNotManageableError('not_booked');

    return { appointmentId: appointment.id, cancelled: true };
  });
}

// ---------------------------------------------------------------------------
// Reschedule
// ---------------------------------------------------------------------------

export async function rescheduleBooking(
  pool: Pool,
  request: RescheduleRequest,
): Promise<RescheduleResult> {
  // Step 0, in its own short transaction: find out what is being moved. It has
  // to precede the availability check, because the check needs this
  // appointment's service and the id to disregard.
  const appointment = await withContext(pool, { tenantId: request.tenantId }, (client) =>
    fetchByToken(client, request.token),
  );
  if (!appointment) throw new AppointmentNotFoundError();
  if (appointment.status !== 'BOOKED') {
    throw new AppointmentNotManageableError('not_booked');
  }
  if (appointment.startsAt.getTime() <= request.now.getTime()) {
    throw new AppointmentNotManageableError('already_started');
  }

  const staffId = request.staffId ?? appointment.staffId;
  if (!staffId) {
    // A resource-only appointment with no stylist. Nothing in the public flow
    // creates one, and moving it would need a different availability question
    // than "which stylist is free".
    throw new SlotNotOfferedError('this appointment has no stylist and cannot be rescheduled here');
  }

  const slotRequest: SlotRequest = {
    tenantId: request.tenantId,
    timeZone: request.timeZone,
    serviceId: appointment.serviceId,
    staffId,
    startsAt: request.startsAt,
    now: request.now,
  };

  // Step 1 — the courtesy check, with this appointment excluded from the busy
  // set. Without the exclusion, every time overlapping where it already sits
  // would be reported unavailable by the appointment's own row.
  const slot = await requireOfferedSlot(pool, slotRequest, appointment.id);

  const resourceId = slot.resourceIds[0] ?? null;

  // Step 2 — the authority.
  return withContext(pool, { tenantId: request.tenantId }, async (client) => {
    const { rows: serviceRows } = await client.query<{
      bufferBeforeMinutes: number;
      bufferAfterMinutes: number;
    }>(
      `SELECT buffer_before_minutes AS "bufferBeforeMinutes",
              buffer_after_minutes  AS "bufferAfterMinutes"
       FROM service
       WHERE id = $1`,
      [appointment.serviceId],
    );
    const buffers = serviceRows[0];
    if (!buffers) throw new ServiceNotFoundError(appointment.serviceId);

    const blockedStartsAt = slot.startsAt.subtract({ minutes: buffers.bufferBeforeMinutes });
    const blockedEndsAt = slot.endsAt.add({ minutes: buffers.bufferAfterMinutes });

    try {
      const { rowCount } = await client.query(
        `UPDATE appointment
         SET staff_id          = $2,
             resource_id       = $3,
             starts_at         = $4,
             ends_at           = $5,
             blocked_starts_at = $6,
             blocked_ends_at   = $7
         WHERE id = $1 AND status = 'BOOKED'`,
        [
          appointment.id,
          staffId,
          resourceId,
          new Date(slot.startsAt.epochMilliseconds),
          new Date(slot.endsAt.epochMilliseconds),
          new Date(blockedStartsAt.epochMilliseconds),
          new Date(blockedEndsAt.epochMilliseconds),
        ],
      );
      // Zero rows means the status changed between step 0 and here — somebody
      // cancelled it, or the owner marked it complete, while this request was
      // computing availability. Not a lost race for the slot; a lost race for
      // the appointment.
      if (rowCount !== 1) throw new AppointmentNotManageableError('not_booked');

      return {
        appointmentId: appointment.id,
        staffId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      };
    } catch (error) {
      if (isExclusionViolation(error)) {
        throw new SlotTakenError(`${request.startsAt.toString()} was taken`);
      }
      throw error;
    }
  });
}
