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

/** One organization the signed-in user belongs to, from GET /me/organizations. */
export interface Membership {
  tenantId: string;
  name: string;
  slug: string;
  timezone: string;
  role: string;
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

  // PATCH answers 204 with no body.
  if (response.status === 204) return undefined as T;
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

/** Needs the session cookie, which a same-origin fetch sends by default. */
export function getMyOrganizations(): Promise<Membership[]> {
  return send<Membership[]>('/me/organizations');
}

/** POST /me/tenants. 201 creates; 200 means an earlier attempt already did. */
export function createTenant(body: { name: string; slug: string; timezone: string }): Promise<{ slug: string }> {
  return send<{ slug: string }>('/me/tenants', { method: 'POST', body: JSON.stringify(body) });
}

// --- setup, under /tenant/:slug (owners and managers) ------------------------

/** Weekday is ISO, 1 = Monday. Times are HH:MM local; an end of 00:00 is midnight. */
export interface HoursRange {
  weekday: number;
  start: string;
  end: string;
}

export interface StaffMember {
  id: string;
  name: string;
  hours: HoursRange[];
}

export interface Resource {
  id: string;
  name: string;
}

export interface ServiceInput {
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  staffIds: string[];
  resourceIds: string[];
}

export interface OwnerService extends ServiceInput {
  id: string;
}

const owner = (slug: string, path: string) => `/tenant/${encodeURIComponent(slug)}${path}`;
const write = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const ownerApi = {
  staff: (slug: string) => send<StaffMember[]>(owner(slug, '/staff')),
  addStaff: (slug: string, name: string) => send<StaffMember>(owner(slug, '/staff'), write('POST', { name })),
  renameStaff: (slug: string, id: string, name: string) =>
    send<void>(owner(slug, `/staff/${id}`), write('PATCH', { name })),
  saveStaffHours: (slug: string, id: string, hours: HoursRange[]) =>
    send<{ hours: HoursRange[] }>(owner(slug, `/staff/${id}/hours`), write('PUT', { hours })),

  businessHours: (slug: string) => send<{ hours: HoursRange[] }>(owner(slug, '/business-hours')),
  saveBusinessHours: (slug: string, hours: HoursRange[]) =>
    send<{ hours: HoursRange[] }>(owner(slug, '/business-hours'), write('PUT', { hours })),

  resources: (slug: string) => send<Resource[]>(owner(slug, '/resources')),
  addResource: (slug: string, name: string) => send<Resource>(owner(slug, '/resources'), write('POST', { name })),

  services: (slug: string) => send<OwnerService[]>(owner(slug, '/services')),
  addService: (slug: string, input: ServiceInput) =>
    send<OwnerService>(owner(slug, '/services'), write('POST', input)),
  saveService: (slug: string, id: string, input: ServiceInput) =>
    send<OwnerService>(owner(slug, `/services/${id}`), write('PUT', input)),
  deleteStaff: (slug: string, id: string) => send<void>(owner(slug, `/staff/${id}`), { method: 'DELETE' }),
  deleteService: (slug: string, id: string) => send<void>(owner(slug, `/services/${id}`), { method: 'DELETE' }),
  deleteResource: (slug: string, id: string) => send<void>(owner(slug, `/resources/${id}`), { method: 'DELETE' }),
};

// --- owner calendar ----------------------------------------------------------

export interface CalendarAppointment {
  id: string;
  staffId: string | null;
  serviceId: string;
  serviceName: string;
  resourceId: string | null;
  resourceName: string | null;
  startsAt: string;
  endsAt: string;
  customer: { name: string; email: string; phone: string | null };
}

export interface CalendarData {
  timeZone: string;
  /** archived: removed, shown only on days with their past appointments. */
  staff: (StaffMember & { archived: boolean })[];
  businessHours: HoursRange[];
  timeOff: { staffId: string; startsAt: string; endsAt: string; reason: string | null }[];
  appointments: CalendarAppointment[];
}

export interface BusyInterval {
  startsAt: string;
  endsAt: string;
  appointmentId: string;
}

export type StaffReason =
  | { reason: 'busy'; staffId: string; busyInterval: BusyInterval }
  | { reason: 'timeOff'; staffId: string; timeOff: { startsAt: string; endsAt: string } }
  | { reason: 'outsideWorkingHours'; staffId: string };

export type TenantReason =
  | { reason: 'doesNotFitBeforeClosing'; closesAt: string }
  | { reason: 'noAvailableResource'; conflicts: { resourceId: string; busyInterval: BusyInterval }[] }
  | { reason: 'tooSoon'; earliestBookableAt: string };

export interface ExcludedTime {
  startsAt: string;
  reason: StaffReason[] | TenantReason;
}

export type ExplainDay =
  | { date: string; status: 'closed' }
  | {
      date: string;
      status: 'open';
      slots: { startsAt: string; endsAt: string; staffIds: string[]; resourceIds: string[] }[];
      excluded: ExcludedTime[];
    };

export interface Explain {
  timeZone: string;
  noQualifiedStaff: boolean;
  days: ExplainDay[];
}

export const calendarApi = {
  calendar: (slug: string, from: string, through: string) =>
    send<CalendarData>(owner(slug, `/calendar?${new URLSearchParams({ from, through })}`)),
  explain: (slug: string, serviceId: string, from: string, through: string, staffId?: string) => {
    const query = new URLSearchParams({ serviceId, from, through });
    if (staffId) query.set('staffId', staffId);
    return send<Explain>(owner(slug, `/availability/explain?${query}`));
  },
  book: (
    slug: string,
    body: { serviceId: string; staffId: string; startsAt: string; customer: { name: string; email: string; phone?: string } },
  ) => send<Rescheduled>(owner(slug, '/appointments'), write('POST', body)),
  cancel: (slug: string, id: string) => send<Cancelled>(owner(slug, `/appointments/${id}/cancel`), write('POST', {})),
  move: (slug: string, id: string, startsAt: string, staffId?: string) =>
    send<Rescheduled>(owner(slug, `/appointments/${id}/reschedule`), write('POST', staffId ? { startsAt, staffId } : { startsAt })),
};

/** GET /tenant/:slug — the signed-in owner's view of their own tenant. */
export function getTenantContext(slug: string): Promise<{ tenant: { name: string; slug: string; timezone: string }; membership: { role: string } }> {
  return send(owner(slug, ''));
}

// --- people: who signs in, and invitations -----------------------------------

/** Better Auth's role names. "admin" is shown as manager. */
export type MemberRole = 'owner' | 'admin' | 'member';

export interface Person {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: MemberRole;
  /** The staff row this login is linked to, if any. */
  staffId: string | null;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: MemberRole;
  staffId: string | null;
  expiresAt: string;
}

export const peopleApi = {
  list: (slug: string) => send<{ members: Person[]; invitations: PendingInvitation[] }>(owner(slug, '/people')),
  invite: (slug: string, body: { email: string; role: 'staff' | 'manager'; staffId?: string }) =>
    send<{ invitationId: string }>(owner(slug, '/invitations'), write('POST', body)),
  remove: (slug: string, memberId: string) =>
    send<void>(owner(slug, `/members/${encodeURIComponent(memberId)}`), { method: 'DELETE' }),
};

/** POST /me/invitations/:id/accept. Safe to repeat. */
export function acceptInvitation(id: string): Promise<{ slug: string; role: MemberRole }> {
  return send(`/me/invitations/${encodeURIComponent(id)}/accept`, { method: 'POST' });
}

// --- a staff member's own page -----------------------------------------------

export const myWeekApi = {
  /** The same shape as the calendar, holding only the caller's own row. */
  week: (slug: string, from: string, through: string) =>
    send<CalendarData>(owner(slug, `/me/week?${new URLSearchParams({ from, through })}`)),
  saveHours: (slug: string, hours: HoursRange[]) =>
    send<{ hours: HoursRange[] }>(owner(slug, '/me/hours'), write('PUT', { hours })),
};
