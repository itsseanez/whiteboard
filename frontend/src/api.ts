// Every API path is relative, so this file has no notion of a base URL: in
// production Express serves these pages from the same origin, and in
// development Vite proxies the same paths to the API. See vite.config.ts.
//
// Instants cross the wire as ISO strings and stay strings in here. They are
// never parsed into a Date and re-serialised — the booking and reschedule
// endpoints want back exactly the startsAt that availability handed out, and a
// round trip through Date is a chance to lose it. Formatting for display is
// format.ts's job and happens at the edge, on the way to the screen.

export interface Staff {
  id: string;
  name: string;
}

export interface Service {
  id: string;
  name: string;
  durationMinutes: number;
  staff: Staff[];
}

export interface Catalog {
  tenant: { name: string; slug: string; timeZone: string };
  services: Service[];
}

export interface Slot {
  startsAt: string;
  endsAt: string;
  staffIds: string[];
}

export type Day =
  | { date: string; status: 'closed' }
  | { date: string; status: 'open'; slots: Slot[] };

export interface Availability {
  timeZone: string;
  noQualifiedStaff: boolean;
  days: Day[];
}

export interface Booked {
  appointmentId: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
  manageToken: string;
}

export interface Rescheduled {
  appointmentId: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
}

export interface Cancelled {
  appointmentId: string;
  status: 'CANCELLED';
  cancelled: boolean;
}

/**
 * A failed request, carrying the API's own error code.
 *
 * `code` is the machine-readable string the endpoints return — `slot_taken`,
 * `already_started`, `appointment_not_found`. The pages switch on it rather
 * than on the status, because 409 covers four different situations that need
 * four different sentences.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`${status} ${code}`);
  }
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  // Spread rather than `headers: cond ? x : undefined`. Under
  // exactOptionalPropertyTypes an optional property may be absent or a
  // HeadersInit, but not an explicit undefined — so the key has to not exist
  // at all on a GET, which is what the spread of an empty object achieves.
  const response = await fetch(path, {
    ...init,
    ...(init?.body ? { headers: { 'content-type': 'application/json' } } : {}),
  });

  if (!response.ok) {
    // A 500 from Express is an HTML error page, not JSON, so parsing is
    // allowed to fail and the status still has to produce a usable error.
    let code = 'request_failed';
    try {
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === 'string') code = body.error;
    } catch {
      // Keep the fallback.
    }
    throw new ApiError(response.status, code);
  }

  return (await response.json()) as T;
}

export function getCatalog(slug: string): Promise<Catalog> {
  return send<Catalog>(`/${encodeURIComponent(slug)}/services`);
}

export function getAvailability(
  slug: string,
  serviceId: string,
  from: string,
  through: string,
  staffId?: string,
): Promise<Availability> {
  const query = new URLSearchParams({ serviceId, from, through });
  if (staffId) query.set('staffId', staffId);
  return send<Availability>(`/${encodeURIComponent(slug)}/availability?${query}`);
}

export function createBooking(
  slug: string,
  body: {
    serviceId: string;
    staffId: string;
    startsAt: string;
    customer: { name: string; email: string; phone?: string };
  },
): Promise<Booked> {
  return send<Booked>(`/${encodeURIComponent(slug)}/appointments`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function cancelBooking(slug: string, token: string): Promise<Cancelled> {
  return send<Cancelled>(`/${encodeURIComponent(slug)}/appointments/cancel`, {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export function rescheduleBooking(
  slug: string,
  token: string,
  startsAt: string,
  staffId?: string,
): Promise<Rescheduled> {
  return send<Rescheduled>(`/${encodeURIComponent(slug)}/appointments/reschedule`, {
    method: 'POST',
    body: JSON.stringify(staffId ? { token, startsAt, staffId } : { token, startsAt }),
  });
}
