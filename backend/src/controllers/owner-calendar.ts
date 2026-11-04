// Owner calendar under /tenant/:slug, behind requireOwner:
//   GET  /calendar?from&through            what to draw for those dates
//   GET  /availability/explain?serviceId&from&through
//                                          the engine's full result, reasons included
//   POST /appointments                     book on a customer's behalf
//   POST /appointments/:id/cancel
//   POST /appointments/:id/reschedule      { startsAt, staffId? }
//
// Owner bookings go through the same offered-slot check and exclusion
// constraints as the public page; an owner can't book a time the engine refuses.

import type { Request, Response } from 'express';
import { appPool } from '../db.js';
import { getAvailability } from '../services/availability.js';
import { createBooking } from '../services/booking.js';
import { cancelBooking, rescheduleBooking } from '../services/manage-booking.js';
import { getCalendar } from '../services/calendar.js';
import { parseRequest as parseAvailability } from './availability.js';
import { parseBooking } from './booking.js';
import { sendManageError } from './manage-booking.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 7;

function one(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export async function getOwnerCalendar(req: Request, res: Response) {
  const from = one(req.query.from);
  const through = one(req.query.through) ?? from;
  if (!from || !through || !DATE.test(from) || !DATE.test(through)) {
    return res.status(400).json({ error: 'from and through must be dates (YYYY-MM-DD)' });
  }
  let days: number;
  try {
    days = Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(through), { largestUnit: 'day' }).days + 1;
  } catch {
    return res.status(400).json({ error: 'from and through must be real dates' });
  }
  if (days < 1 || days > MAX_DAYS) {
    return res.status(400).json({ error: `range must be 1 to ${MAX_DAYS} days` });
  }
  const tenant = req.tenant!;
  res.json(await getCalendar(tenant.id, tenant.timezone, from, through));
}

export async function getExplain(req: Request, res: Response) {
  const parsed = parseAvailability(req);
  if (!parsed.ok) return res.status(parsed.status).json({ error: parsed.error });
  try {
    const result = await getAvailability(appPool, { ...parsed.value, now: new Date(), excludeAppointmentId: null });
    // Temporal values serialise through their toJSON, as ISO strings.
    res.json({ timeZone: parsed.value.timeZone, ...result });
  } catch (error) {
    if (!sendManageError(res, error)) throw error;
  }
}

export async function postOwnerBooking(req: Request, res: Response) {
  const parsed = parseBooking(req);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    // The manage token is discarded: emailing it to the customer isn't built yet.
    const booked = await createBooking(appPool, { ...parsed.value, now: new Date() });
    res.status(201).json({
      appointmentId: booked.id,
      staffId: booked.staffId,
      startsAt: booked.startsAt.toString(),
      endsAt: booked.endsAt.toString(),
    });
  } catch (error) {
    if (!sendManageError(res, error)) throw error;
  }
}

function appointmentId(req: Request): string | null {
  const id = req.params.id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

export async function postOwnerCancel(req: Request, res: Response) {
  const id = appointmentId(req);
  if (!id) return res.status(404).json({ error: 'appointment_not_found' });
  try {
    const result = await cancelBooking(appPool, { tenantId: req.tenant!.id, ref: { appointmentId: id }, now: new Date() });
    res.json({ appointmentId: result.appointmentId, status: 'CANCELLED', cancelled: result.cancelled });
  } catch (error) {
    if (!sendManageError(res, error)) throw error;
  }
}

export async function postOwnerReschedule(req: Request, res: Response) {
  const id = appointmentId(req);
  if (!id) return res.status(404).json({ error: 'appointment_not_found' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  let startsAt: Temporal.Instant;
  try {
    startsAt = Temporal.Instant.from(String(body.startsAt));
  } catch {
    return res.status(400).json({ error: 'startsAt must be an ISO instant with an offset or Z' });
  }
  const staffId = one(body.staffId);
  if (staffId !== undefined && !UUID.test(staffId)) return res.status(400).json({ error: 'staffId must be a uuid' });
  try {
    const result = await rescheduleBooking(appPool, {
      tenantId: req.tenant!.id,
      timeZone: req.tenant!.timezone,
      ref: { appointmentId: id },
      startsAt,
      staffId: staffId ?? null,
      now: new Date(),
    });
    res.json({
      appointmentId: result.appointmentId,
      staffId: result.staffId,
      startsAt: result.startsAt.toString(),
      endsAt: result.endsAt.toString(),
    });
  } catch (error) {
    if (!sendManageError(res, error)) throw error;
  }
}
