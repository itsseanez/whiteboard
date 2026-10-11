// The request boundary. Everything that can be wrong with the REQUEST is
// rejected here with a 400, so nothing downstream has to decide whether a bad
// date is the client's fault or the server's.
//
// This is also the only place in the availability path that reads a clock. The
// engine takes `now` as an argument so its DST tests can run at any time of
// year; that promise is kept by calling new Date() here and nowhere deeper.

import type { Request, Response } from 'express';
import { publicPool } from '../db.js';
import {
  ServiceNotFoundError,
  getAvailability,
  type AvailabilityQuery,
} from '../services/availability.js';
import type { AvailabilityResult } from '../availability/types.js';

/** A month view is the largest range any real booking UI asks for. */
const MAX_RANGE_DAYS = 31;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Express gives a query param as string | string[] | object. Take one string. */
function oneString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

type Parsed =
  // Both omitted fields are supplied by the handler, not parsed from the
  // request: `now` is the single clock read, and excludeAppointmentId is always
  // null here because a browsing customer has no appointment of their own in
  // play. Neither is a client-settable input.
  | { ok: true; value: Omit<AvailabilityQuery, 'now' | 'excludeAppointmentId'> }
  | { ok: false; status: 400; error: string };

function parseRequest(req: Request): Parsed {
  // req.tenant is set by resolveTenantFromSlug. It is checked rather than
  // trusted because reaching this controller without the middleware would be a
  // routing mistake, and `undefined` as a time zone throws deep inside Temporal
  // where the message tells you nothing.
  const tenant = req.tenant;
  if (!tenant?.id || !tenant.timezone) {
    return { ok: false, status: 400, error: 'Tenant not resolved' };
  }

  const serviceId = oneString(req.query.serviceId);
  if (!serviceId || !UUID.test(serviceId)) {
    return { ok: false, status: 400, error: 'serviceId must be a uuid' };
  }

  const staffId = oneString(req.query.staffId);
  if (staffId !== undefined && !UUID.test(staffId)) {
    return { ok: false, status: 400, error: 'staffId must be a uuid' };
  }

  const from = oneString(req.query.from);
  const through = oneString(req.query.through) ?? from;
  if (!from || !through) {
    return { ok: false, status: 400, error: 'from is required (YYYY-MM-DD)' };
  }

  // Parsed here so a malformed date is a 400. Left to the mapper it becomes a
  // RangeError deep in the request and surfaces as a 500.
  let fromDate: Temporal.PlainDate;
  let throughDate: Temporal.PlainDate;
  try {
    fromDate = Temporal.PlainDate.from(from);
    throughDate = Temporal.PlainDate.from(through);
  } catch {
    return { ok: false, status: 400, error: 'from and through must be dates (YYYY-MM-DD)' };
  }

  if (Temporal.PlainDate.compare(throughDate, fromDate) < 0) {
    return { ok: false, status: 400, error: 'through must not be before from' };
  }

  // A calendar difference, so a clock change cannot make a 31-day month look
  // like 30 days and 23 hours.
  const days = fromDate.until(throughDate, { largestUnit: 'day' }).days + 1;
  if (days > MAX_RANGE_DAYS) {
    return {
      ok: false,
      status: 400,
      error: `range must be ${MAX_RANGE_DAYS} days or fewer (asked for ${days})`,
    };
  }

  return {
    ok: true,
    value: {
      tenantId: tenant.id,
      timeZone: tenant.timezone,
      serviceId,
      preferredStaffId: staffId ?? null,
      fromDate: fromDate.toString(),
      throughDate: throughDate.toString(),
    },
  };
}

// ---------------------------------------------------------------------------
// Response shaping
//
// Instants go out as ISO strings and the tenant's zone goes out beside them,
// because the settled decision is that the API returns moments and the frontend
// formats them with Intl.DateTimeFormat — stable Safari has no Temporal.
// ---------------------------------------------------------------------------

/**
 * The public view: day status and bookable times, nothing else.
 *
 * `excluded` is deliberately dropped. Its reasons carry appointment ids and the
 * exact spans staff are busy, which together are a readable map of the salon's
 * whole schedule. Coarsening them does not help — a greyed-out time labelled
 * 'busy' still maps the day. The full result, reasons included, belongs on the
 * owner's calendar.
 *
 * `resourceIds` is dropped too: a customer does not choose a wash station, and
 * which station gets assigned is the booking endpoint's business. `staffIds`
 * stays, because a customer may well pick their stylist.
 */
function toPublicResponse(result: AvailabilityResult, timeZone: string) {
  return {
    timeZone,
    noQualifiedStaff: result.noQualifiedStaff,
    days: result.days.map((day) =>
      day.status === 'closed'
        ? { date: day.date.toString(), status: 'closed' as const }
        : {
          date: day.date.toString(),
          status: 'open' as const,
          slots: day.slots.map((slot) => ({
            startsAt: slot.startsAt.toString(),
            endsAt: slot.endsAt.toString(),
            staffIds: slot.staffIds,
          })),
        },
    ),
  };
}

// ---------------------------------------------------------------------------

export async function getPublicAvailability(req: Request, res: Response): Promise<void> {
  const parsed = parseRequest(req);
  if (!parsed.ok) {
    res.status(parsed.status).json({ error: parsed.error });
    return;
  }

  // The one clock read in the whole availability path.
  // excludeAppointmentId is null here: a browsing customer is asking what is
  // free, with no appointment of their own in play.
  const query: AvailabilityQuery = {
    ...parsed.value,
    now: new Date(),
    excludeAppointmentId: null,
  };

  try {
    const result = await getAvailability(publicPool, query);
    res.json(toPublicResponse(result, query.timeZone));
  } catch (error) {
    // RLS makes "no such service" and "another tenant's service" the same zero
    // rows, which is the same disguised 404 the tenant routes already use.
    if (error instanceof ServiceNotFoundError) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    throw error;
  }
}
