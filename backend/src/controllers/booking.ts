// src/controllers/booking.ts
//
// POST /:slug/appointments — the public booking write path.
//
// Status codes, and why each:
//   201  booked, with the appointment id and the times as instants
//   400  the request was never valid: bad uuid, unparseable time, missing name
//   404  no such service, or another tenant's service (RLS makes them identical)
//   409  the slot was taken, or is no longer on offer
//
// 409 rather than 400 for a lost race, because nothing was wrong with the
// request — the world changed between the page load and the submit, and the
// right client behaviour is to refresh the slots and try again. 409 for
// not-offered too, for the same reason: the usual cause is a stale page.

import type { Request, Response } from 'express';
import { publicPool } from '../db.js';
import { ServiceNotFoundError } from '../services/availability.js';
import {
  SlotNotOfferedError,
  SlotTakenError,
  createBooking,
  type BookingRequest,
} from '../services/booking.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deliberately permissive: shape only. Deliverability is not our business. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MAX_NAME = 200;
const MAX_EMAIL = 320; // 64 local + @ + 255 domain
const MAX_PHONE = 40;

type Parsed =
  | { ok: true; value: Omit<BookingRequest, 'now'> }
  | { ok: false; error: string };

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function parseBooking(req: Request): Parsed {
  const tenant = req.tenant;
  if (!tenant?.id || !tenant.timezone) {
    return { ok: false, error: 'Tenant not resolved' };
  }

  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const { serviceId, staffId, startsAt, customer } = body as Record<string, unknown>;

  const service = asString(serviceId);
  if (!service || !UUID.test(service)) {
    return { ok: false, error: 'serviceId must be a uuid' };
  }

  // Required, not optional. "Book me with anyone" is a product decision that
  // needs its own answer — which stylist gets the work — and it is not this
  // endpoint's to invent.
  const staff = asString(staffId);
  if (!staff || !UUID.test(staff)) {
    return { ok: false, error: 'staffId must be a uuid' };
  }

  const start = asString(startsAt);
  if (!start) {
    return { ok: false, error: 'startsAt is required (an ISO instant, e.g. 2026-10-27T09:00:00Z)' };
  }
  let startsAtInstant: Temporal.Instant;
  try {
    // Instant.from demands an offset or Z, so a bare "2026-10-27T09:00" is
    // rejected rather than silently read in some zone. The client sends back
    // exactly the startsAt the availability response gave it.
    startsAtInstant = Temporal.Instant.from(start);
  } catch {
    return { ok: false, error: 'startsAt must be an ISO instant with an offset or Z' };
  }

  if (typeof customer !== 'object' || customer === null) {
    return { ok: false, error: 'customer must be an object with name and email' };
  }
  const { name, email, phone } = customer as Record<string, unknown>;

  const customerName = asString(name);
  if (!customerName || customerName.length > MAX_NAME) {
    return { ok: false, error: `customer.name is required and must be at most ${MAX_NAME} characters` };
  }

  const customerEmail = asString(email);
  if (!customerEmail || customerEmail.length > MAX_EMAIL || !EMAIL.test(customerEmail)) {
    return { ok: false, error: 'customer.email must look like an email address' };
  }

  const customerPhone = asString(phone);
  if (customerPhone !== undefined && customerPhone.length > MAX_PHONE) {
    return { ok: false, error: `customer.phone must be at most ${MAX_PHONE} characters` };
  }

  return {
    ok: true,
    value: {
      tenantId: tenant.id,
      timeZone: tenant.timezone,
      serviceId: service,
      staffId: staff,
      startsAt: startsAtInstant,
      customer: {
        name: customerName,
        email: customerEmail,
        phone: customerPhone && customerPhone.length > 0 ? customerPhone : null,
      },
    },
  };
}

export async function postPublicBooking(req: Request, res: Response): Promise<void> {
  const parsed = parseBooking(req);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  // The only clock read on the write path, matching the availability endpoint.
  const request: BookingRequest = { ...parsed.value, now: new Date() };

  try {
    const booked = await createBooking(publicPool, request);

    // Nothing about the customer goes back out. The client sent that data and
    // already has it; echoing it would make this endpoint a way to confirm
    // whether an email address is on file.
    res.status(201).json({
      appointmentId: booked.id,
      staffId: booked.staffId,
      startsAt: booked.startsAt.toString(),
      endsAt: booked.endsAt.toString(),
      // The only time this is ever emitted. It goes into the confirmation
      // email's cancel and reschedule links; the database holds only its hash,
      // so it cannot be re-issued or looked up later.
      manageToken: booked.manageToken,
    });
  } catch (error) {
    if (error instanceof ServiceNotFoundError) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    if (error instanceof SlotTakenError) {
      res.status(409).json({ error: 'slot_taken' });
      return;
    }
    if (error instanceof SlotNotOfferedError) {
      res.status(409).json({ error: 'slot_not_available' });
      return;
    }
    throw error;
  }
}
