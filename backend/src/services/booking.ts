// The write half of the booking flow. Two steps that are deliberately NOT one
// transaction, and the reason is the whole design:
//
//   1. Re-compute availability and confirm the requested start is genuinely on
//      offer. This is a courtesy check. It catches a client asking for 03:00,
//      or a stylist who is not qualified, and it turns those into a clear 4xx
//      rather than a successful booking nobody can honour.
//
//   2. Insert, inside a transaction, and let the exclusion constraint decide.
//      This is the authority.
//
// Making step 1 atomic with step 2 would buy nothing. Whatever lock we took
// over step 1, the only thing that can actually prevent a double booking is the
// constraint in step 2 — so the check is allowed to be stale, and when it is,
// the constraint rejects the insert and the customer gets a 409. The window
// between the two steps is exactly the window the constraint exists to close.
//
// That is worth saying out loud, because "check then write" is the classic
// broken pattern. It is only safe here because the write is independently
// guarded; the check is for error messages, not for correctness.

import type { Pool, PoolClient } from 'pg';
import { withContext } from '../withContext.js';
import { getAvailability, ServiceNotFoundError } from './availability.js';
import type { Slot } from '../availability/types.js';

/** The requested time is not among the offered slots — never was, or no longer is. */
export class SlotNotOfferedError extends Error { }

/** The slot was offered and lost a race. SQLSTATE 23P01 from the constraint. */
export class SlotTakenError extends Error { }

export interface BookingRequest {
  tenantId: string;
  timeZone: string;
  serviceId: string;
  /** Required: a customer books with a named stylist, not "anyone". */
  staffId: string;
  startsAt: Temporal.Instant;
  customer: { name: string; email: string; phone: string | null };
  /** Read once in the controller, passed down, never read here. */
  now: Date;
}

export interface BookedAppointment {
  id: string;
  staffId: string;
  startsAt: Temporal.Instant;
  endsAt: Temporal.Instant;
}

interface ServiceBuffers {
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

/**
 * Postgres raises 23P01 (exclusion_violation) when either no-overlap
 * constraint rejects a row. Narrowed by code rather than by message, which is
 * localised and formatted for humans.
 */
function isExclusionViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23P01';
}

async function fetchServiceBuffers(
  client: PoolClient,
  serviceId: string,
): Promise<ServiceBuffers> {
  const { rows } = await client.query<ServiceBuffers>(
    `SELECT buffer_before_minutes AS "bufferBeforeMinutes",
            buffer_after_minutes  AS "bufferAfterMinutes"
     FROM service
     WHERE id = $1`,
    [serviceId],
  );
  const service = rows[0];
  // Re-read inside the write transaction rather than carried from step 1: these
  // are what the stored blocked interval is built from, so they must be the
  // values in force at the moment of the insert.
  if (!service) throw new ServiceNotFoundError(serviceId);
  return service;
}

/**
 * The customer, created or recognised.
 *
 * Keyed on (tenant_id, lower(email)) by the unique index, so the same person
 * booking twice gets one row and their history stays joined up. The conflict
 * action only fills in a phone number — it never overwrites the name, so
 * knowing somebody's email address is not enough to rewrite their record.
 */
async function upsertCustomer(
  client: PoolClient,
  tenantId: string,
  customer: BookingRequest['customer'],
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO customer (tenant_id, name, email, phone)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, lower(email))
       DO UPDATE SET phone = COALESCE(EXCLUDED.phone, customer.phone)
     RETURNING id`,
    [tenantId, customer.name, customer.email, customer.phone],
  );
  const row = rows[0];
  if (!row) throw new Error('customer upsert returned no row');
  return row.id;
}

/** Step 1. Throws SlotNotOfferedError unless this exact start is on offer. */
async function requireOfferedSlot(pool: Pool, request: BookingRequest): Promise<Slot> {
  const date = request.startsAt.toZonedDateTimeISO(request.timeZone).toPlainDate().toString();

  const availability = await getAvailability(pool, {
    tenantId: request.tenantId,
    timeZone: request.timeZone,
    serviceId: request.serviceId,
    // Narrowing to the requested stylist means the returned slots are exactly
    // the ones this person can take.
    preferredStaffId: request.staffId,
    fromDate: date,
    throughDate: date,
    now: request.now,
  });

  const day = availability.days[0];
  if (!day || day.status !== 'open') {
    throw new SlotNotOfferedError(`${date} is not open for bookings`);
  }

  const slot = day.slots.find((candidate) => candidate.startsAt.equals(request.startsAt));
  if (!slot || !slot.staffIds.includes(request.staffId)) {
    throw new SlotNotOfferedError(`${request.startsAt.toString()} is not an available slot`);
  }
  return slot;
}

export async function createBooking(
  pool: Pool,
  request: BookingRequest,
): Promise<BookedAppointment> {
  const slot = await requireOfferedSlot(pool, request);

  // Which resource, when the service needs one. The engine already excluded any
  // that are occupied, so the first free one is as good as any — picking the
  // least-used would be a scheduling optimisation, and that is parked.
  const resourceId = slot.resourceIds[0] ?? null;

  return withContext(pool, { tenantId: request.tenantId }, async (client) => {
    const buffers = await fetchServiceBuffers(client, request.serviceId);

    // The service times the customer sees come from the engine; the blocked
    // interval is those widened by the buffers in force right now. The database
    // re-checks that blocked contains service, so a mistake here fails loudly.
    const blockedStartsAt = slot.startsAt.subtract({ minutes: buffers.bufferBeforeMinutes });
    const blockedEndsAt = slot.endsAt.add({ minutes: buffers.bufferAfterMinutes });

    const customerId = await upsertCustomer(client, request.tenantId, request.customer);

    try {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO appointment (
           tenant_id, staff_id, service_id, resource_id, customer_id,
           starts_at, ends_at, blocked_starts_at, blocked_ends_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          request.tenantId,
          request.staffId,
          request.serviceId,
          resourceId,
          customerId,
          new Date(slot.startsAt.epochMilliseconds),
          new Date(slot.endsAt.epochMilliseconds),
          new Date(blockedStartsAt.epochMilliseconds),
          new Date(blockedEndsAt.epochMilliseconds),
        ],
      );
      const row = rows[0];
      if (!row) throw new Error('appointment insert returned no row');

      return {
        id: row.id,
        staffId: request.staffId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      };
    } catch (error) {
      // The race was lost. withContext rolls the transaction back, so the
      // upserted customer disappears with it — no orphan.
      if (isExclusionViolation(error)) {
        throw new SlotTakenError(`${request.startsAt.toString()} was taken`);
      }
      throw error;
    }
  });
}
