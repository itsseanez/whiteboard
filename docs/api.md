# API

A JSON REST API served by the same Express process as the frontend. Every
route below is live at `https://whiteboardhq.app`. Times go in and out as ISO
instants with an offset or `Z`; dates as `YYYY-MM-DD` in the organization's own
zone. Errors are `{ "error": "<code or message>" }` with a 4xx status.

There are three audiences, and each has its own database role
([`database-roles.md`](database-roles.md)):

| Prefix | Who | Auth |
|---|---|---|
| `/:slug/...` | Customers booking with an organization | None |
| `/me/...` | Any signed-in user | Session cookie |
| `/tenant/:slug/...` | An organization's owners, managers and staff | Session cookie, membership |

Sign-up, sign-in, sessions, password reset (`/request-password-reset`, `/reset-password`), email confirmation (`/send-verification-email`, `/verify-email`) and changing your email or password are Better Auth's own routes under `/api/auth/*`. Changing your email also needs `password` in the body.

The public routes are limited per client address, each group with its own
allowance: reads (services, availability) 300 per 5 minutes, bookings 10 per
hour, and anything carrying a manage token 60 per 15 minutes. Past that the
answer is `429 { "error": "rate_limited" }` with a `Retry-After`. Better Auth
limits its own routes.

## Public: `/:slug`

| Method | Path | Does |
|---|---|---|
| `GET` | `/:slug/services` | The organization, its zone, and its services with the staff who perform each |
| `GET` | `/:slug/availability?serviceId&from[&through][&staffId]` | Bookable times per day, up to 31 days |
| `POST` | `/:slug/appointments` | Book a time that availability offered |
| `POST` | `/:slug/appointments/cancel` | Cancel, with the token from booking |
| `POST` | `/:slug/appointments/reschedule` | Move to another offered time, with the same token |
| `POST` | `/:slug/appointments/availability` | Times this appointment can move to, with the same token |

```http
GET /studio-wien/availability?serviceId=…&from=2026-11-17
```

```json
{
  "timeZone": "Europe/Vienna",
  "days": [
    {
      "date": "2026-11-17",
      "status": "open",
      "slots": [{ "startsAt": "2026-11-17T09:00:00Z", "endsAt": "2026-11-17T09:45:00Z", "staffIds": ["…"] }]
    }
  ]
}
```

A closed day is `{ "date": …, "status": "closed" }` with no `slots`. The public
response never says why a time is missing; that is owner-only.

```http
POST /studio-wien/appointments
{ "serviceId": "…", "staffId": "…", "startsAt": "2026-11-17T09:00:00Z",
  "customer": { "name": "Jo", "email": "jo@example.com", "phone": "optional" } }
```

`201` returns `appointmentId`, `staffId`, `startsAt`, `endsAt` and `manageToken`,
plus `emailed`: whether the confirmation email, which carries the same manage
link, went out. A booking never fails because the email did.

The customer is also emailed when an appointment is cancelled or moved, from
their link or from the owner calendar. A repeat cancel sends nothing.
The token is returned once and stored only as a hash; it is what the cancel and
reschedule routes take (`{ "token": … }`, plus `startsAt` and an optional
`staffId` to reschedule). A time that was never offered is `409
slot_not_available`; one somebody else just took is `409 slot_taken`.

`POST /:slug/appointments/availability` takes `{ "token", "from", "through"? }`
and answers in the same shape as `GET /availability`, for the appointment's own
service and stylist with the appointment itself left out. Those come from the
token, not the request, so every time it offers is one reschedule accepts. It
fails like reschedule: `404` for a token that matches nothing here, `409` once
the appointment is cancelled, finished or begun.

## Signed in: `/me`

| Method | Path | Does |
|---|---|---|
| `GET` | `/me/organizations` | The organizations the user belongs to, with their role |
| `POST` | `/me/tenants` | Create an organization `{ name, slug, timezone }`; the caller becomes its owner |
| `POST` | `/me/invitations/:id/accept` | Join the organization that invited the caller |
| `POST` | `/me/tenants/:slug/reopen` | The owner reopens an organization they closed, within 30 days |
| `POST` | `/api/auth/delete-user` | Better Auth's: delete the caller's account, `{ password }` required. `400 OWNS_ORGANIZATIONS` while they own an open organization |

`GET /me/organizations` also lists an owner's closed organizations for the 30
days they can be reopened, with `closedAt` and `reopenUntil` set.

`POST /links/closed { token }` (no session) answers `{ name, closedAt }` when a
manage token belongs to a closed organization, and `404` otherwise. It isn't
under `/:slug`, because after a closed slug is released that slug may belong
to a different organization.

`POST /me/tenants` answers `201` when it created the organization, `200` when an
earlier attempt already had (it is safe to retry), `409 slug_taken` when another
account holds the address, and `400` for a reserved or malformed slug, an
unknown time zone, or a bad name.

Accepting answers `{ slug, role }` and is safe to repeat. It refuses an
invitation sent to another address (`403 wrong_account`), an expired one
(`410 invitation_expired`) or one that was cancelled (`410 invitation_closed`).
A staff invitation links the caller to its staff row; `409 staff_unavailable`
means the row was removed or taken in the meantime.

## Organizations: `/tenant/:slug`

`GET /tenant/:slug` returns the tenant and the caller's membership. Roles are
Better Auth's: `owner`, `admin` (shown as manager) and `member` (staff). A slug
the caller doesn't belong to is `404`, the same as one that doesn't exist.

### Staff: their own page

| Method | Path | Does |
|---|---|---|
| `GET` | `/me/week?from[&through]` | The calendar's shape, holding only the caller's own row and appointments, up to 7 days |
| `PUT` | `/me/hours` | Replace the caller's own week of hours |

Both answer `404 not_staff` for a member with no staff row here.

### Time off: every role

| Method | Path | Does |
|---|---|---|
| `GET` | `/time-off` | Time off that hasn't ended, with `timeZone` |
| `POST` | `/time-off` | Add `{ staffId?, startDate, startTime?, endDate?, endTime?, reason? }` |
| `DELETE` | `/time-off/:id` | Remove one |
| `POST` | `/time-off/:id/approve` | Owners and managers: approve a pending request |
| `POST` | `/time-off/:id/decline` | Owners and managers: decline a pending request |

Dates and times are wall clock in the organization's zone; an empty time means
the whole day, and `endDate` defaults to `startDate`. Owners and managers see
and change anyone's, and what they add is approved at once; what staff add is a
`pending` request for themselves (a left-out `staffId` means the caller), which
they can withdraw until it's approved. Only `approved` time off blocks bookings.
Deciding a request twice is `409 already_decided`; staff deciding is
`403 managers_only`. RLS decides that, so another staff member's entry is `404` to remove
and `403 own_time_off_only` to add. `201` includes `overlappingAppointments`:
booked appointments inside the time off, which stay booked.

### Owners and managers

Everything below needs `owner` or `admin` (`403 managers_only` otherwise).

| Method | Path | Does |
|---|---|---|
| `GET` | `/people` | Members with their role and linked staff row, and pending invitations |
| `POST` | `/invitations` | Invite `{ email, role: "staff", staffId }` or `{ email, role: "manager" }` |
| `PATCH` | `/members/:memberId` | Owner only: set `{ role }` to `owner`, `manager` or `staff`, anyone's including your own; `409 last_owner` if it would leave no owner |
| `DELETE` | `/members/:memberId` | Owner only: end a member's access and free their staff row |
| `DELETE` | `/` (that is, `/tenant/:slug`) | Owner only: close the organization, `{ confirm: "<slug>" }` |

| Method | Path | Does |
|---|---|---|
| `GET` `PUT` | `/business-hours` | Opening hours, replaced a whole week at a time |
| `GET` `POST` | `/staff` | List, add `{ name }` |
| `PATCH` `DELETE` | `/staff/:id` | Rename; remove (archive) |
| `PUT` | `/staff/:id/hours` | Replace one staff member's week |
| `GET` `POST` | `/resources` | List, add `{ name }` |
| `PATCH` `DELETE` | `/resources/:id` | Rename; remove (archive) |
| `GET` `POST` | `/services` | List, add |
| `PUT` `DELETE` | `/services/:id` | Replace; remove (archive) |
| `GET` | `/calendar?from[&through]` | Staff, hours, time off and booked appointments with customer details, up to 7 days |
| `GET` | `/availability/explain?serviceId&from[&through][&staffId]` | Availability with the reason every missing time is missing |
| `POST` | `/appointments` | Book on a customer's behalf, same body as the public route |
| `POST` | `/appointments/:id/cancel` | Cancel |
| `POST` | `/appointments/:id/reschedule` | Move `{ startsAt, staffId? }` |

A week of hours is `{ "hours": [{ "weekday": 1, "start": "09:00", "end": "12:00" }, …] }`:
ISO weekday (1 is Monday), local `HH:MM`, several ranges per day for a split
shift, and an end of `00:00` meaning midnight. Overlapping or reversed ranges
are refused and leave the saved week unchanged.

A service is `{ name, durationMinutes, bufferBeforeMinutes, bufferAfterMinutes,
minimumNoticeMinutes, staffIds, resourceIds }`. `resourceIds` empty means it
needs no resource; otherwise any one of them must be free.

Removing staff, a service or a resource archives it: it disappears from setup,
booking and availability, and past appointments keep it. It is refused with
`409 has_future_appointments` while future bookings depend on it, and a
resource with `409 only_resource_for_service` while it is a service's only one.

An invitation emails a link that works for 7 days; inviting the same address
again sends it again. A manager invite needs an owner (`403 owner_only`). A
staff invite is refused with `409 staff_has_login` when the row already has a
login, and `409 already_member` when the address already belongs here.
`503 email_unavailable` means email isn't configured, and nothing was saved;
`502 email_failed` means the invitation was saved but the email didn't send,
so inviting again resends it.

Closing archives the organization rather than deleting it: every future
booking is cancelled and its customer emailed, past appointments are kept,
and the organization disappears from its booking page, its members' accounts
and every `/tenant/:slug` route. The slug stays taken. It answers
`{ cancelled, emailed }`.

Owner bookings and moves go through the same checks as customers': an owner
can't book a time availability doesn't offer.
