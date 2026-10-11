// src/controllers/manage-booking.ts
//
// POST /:slug/appointments/cancel      { token }
// POST /:slug/appointments/reschedule  { token, startsAt, staffId? }
//
// WHY THE TOKEN IS IN THE BODY AND NOT THE PATH
//
// /appointments/:token/cancel would be the more REST-shaped URL and is the
// wrong choice for a credential. Paths end up in web server access logs, in
// Referer headers sent to any third-party asset the confirmation page loads,
// in browser history, and in analytics. A request body goes to none of those.
// The email link therefore points at a page, and the page posts the token.
//
// WHY POST RATHER THAN DELETE AND PATCH
//
// Same reason, plus one more: the link in the email is clicked by a browser,
// which issues a GET. A GET must not cancel anything — a mail client
// prefetching links, or a corporate scanner following them, would cancel
// appointments on its own. Routing through a page that posts makes the
// mutation deliberate.
//
// Status codes:
//   200  done, or already in the requested state
//   400  the request was never valid
//   404  no appointment matches this token in this tenant
//   409  the appointment exists but cannot be changed, or the slot was lost
//
// 404 covers a wrong token, an expired-by-deletion appointment, and a valid
// token belonging to another salon, all identically. That is the point: the
// response must not confirm that a token is real but for a different tenant.

import type { Request, Response } from 'express';
import { publicPool } from '../db.js';
import { ServiceNotFoundError } from '../services/availability.js';
import { SlotNotOfferedError, SlotTakenError } from '../services/booking.js';
import {
  AppointmentNotFoundError,
  AppointmentNotManageableError,
  cancelBooking,
  rescheduleBooking,
} from '../services/manage-booking.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A base64url-encoded 32-byte token is 43 characters. The cap is generous
 * rather than exact so that a token format change does not become a 400, but
 * bounded so a multi-megabyte string is rejected before it reaches sha256.
 *
 * The shape itself is NOT validated. A malformed token and a wrong token both
 * mean "no such appointment", and distinguishing them in the response would
 * tell a prober which of their guesses were at least well-formed.
 */
const MAX_TOKEN = 200;

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

type TokenParsed = { ok: true; tenantId: string; timeZone: string; token: string } | { ok: false; error: string };

function parseTokenRequest(req: Request): TokenParsed {
  const tenant = req.tenant;
  if (!tenant?.id || !tenant.timezone) {
    return { ok: false, error: 'Tenant not resolved' };
  }

  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'body must be a JSON object' };
  }

  const token = asString((body as Record<string, unknown>).token);
  if (!token || token.length > MAX_TOKEN) {
    return { ok: false, error: 'token is required' };
  }

  return { ok: true, tenantId: tenant.id, timeZone: tenant.timezone, token };
}

/** Shared by both handlers — the failure modes are identical. */
function sendManageError(res: Response, error: unknown): boolean {
  if (error instanceof AppointmentNotFoundError) {
    res.status(404).json({ error: 'appointment_not_found' });
    return true;
  }
  if (error instanceof AppointmentNotManageableError) {
    res.status(409).json({ error: error.reason });
    return true;
  }
  if (error instanceof SlotTakenError) {
    res.status(409).json({ error: 'slot_taken' });
    return true;
  }
  if (error instanceof SlotNotOfferedError) {
    res.status(409).json({ error: 'slot_not_available' });
    return true;
  }
  if (error instanceof ServiceNotFoundError) {
    res.status(404).json({ error: 'Service not found' });
    return true;
  }
  return false;
}

export async function postCancelBooking(req: Request, res: Response): Promise<void> {
  const parsed = parseTokenRequest(req);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  try {
    const result = await cancelBooking(publicPool, {
      tenantId: parsed.tenantId,
      token: parsed.token,
      // The only clock read on this path, matching every other endpoint.
      now: new Date(),
    });

    // 200 either way. `cancelled` says whether this call was the one that did
    // it, which a UI can use to show "cancelled" versus "already cancelled"
    // without having to treat the second click as an error.
    res.status(200).json({
      appointmentId: result.appointmentId,
      status: 'CANCELLED',
      cancelled: result.cancelled,
    });
  } catch (error) {
    if (!sendManageError(res, error)) throw error;
  }
}

export async function postRescheduleBooking(req: Request, res: Response): Promise<void> {
  const parsed = parseTokenRequest(req);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const body = req.body as Record<string, unknown>;

  const start = asString(body.startsAt);
  if (!start) {
    return void res
      .status(400)
      .json({ error: 'startsAt is required (an ISO instant, e.g. 2026-10-27T09:00:00Z)' });
  }
  let startsAt: Temporal.Instant;
  try {
    // Same rule as booking: an offset or Z is mandatory, so a bare local time
    // is never silently interpreted in some zone. The client sends back exactly
    // the startsAt an availability response gave it.
    startsAt = Temporal.Instant.from(start);
  } catch {
    return void res
      .status(400)
      .json({ error: 'startsAt must be an ISO instant with an offset or Z' });
  }

  // Optional. Absent means "keep the stylist I have".
  const staff = asString(body.staffId);
  if (staff !== undefined && staff.length > 0 && !UUID.test(staff)) {
    return void res.status(400).json({ error: 'staffId must be a uuid' });
  }

  try {
    const result = await rescheduleBooking(publicPool, {
      tenantId: parsed.tenantId,
      timeZone: parsed.timeZone,
      token: parsed.token,
      startsAt,
      staffId: staff && staff.length > 0 ? staff : null,
      now: new Date(),
    });

    // The token is not re-issued and not echoed. It still works, which is the
    // reason reschedule is an UPDATE rather than a cancel and a rebook.
    res.status(200).json({
      appointmentId: result.appointmentId,
      staffId: result.staffId,
      startsAt: result.startsAt.toString(),
      endsAt: result.endsAt.toString(),
    });
  } catch (error) {
    if (!sendManageError(res, error)) throw error;
  }
}
