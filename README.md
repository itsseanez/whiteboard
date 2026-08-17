<div align="center">

# Whiteboard

**Multi-tenant booking software for salons and independent service businesses.**

Computed availability across staff and room constraints · timezone-correct through DST · race-free reservation

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-20%20LTS-5FA04E.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-336791.svg)](https://www.postgresql.org/)

[Live demo](#) · [API docs](#) · [Design notes](docs/)

</div>

---

> _screenshot: public booking page_

## Why this exists

A salon in Austria took my booking by writing my name and a time on a whiteboard on the wall.

**For the shop, that whiteboard is close to perfect.** No cost, no training, no login, no subscription, and it never goes down. The entire day is legible at a glance and a booking takes three seconds. Most scheduling software is a downgrade for the people who actually work there — more clicks, more fields, more screens between them and the answer they already had on the wall.

**For me as the customer, it was the opposite.** I had to be standing in the room to book anything. I couldn't see which times were open without asking someone to read the board for me. I couldn't book at 11pm from my hotel, which is when I actually thought about it. No confirmation to check later, no reminder the day before, and by the following week the board had been wiped — no record I'd ever been there.

Those two experiences pull against each other, and most booking products resolve it entirely in the customer's favor while handing the shop a second job. This one tries to keep what the whiteboard does well — the whole day visible at once, a booking in seconds, nothing to learn — and add the part it can't do: a page anyone can open at midnight from another country.

## Engineering highlights

| | |
|---|---|
| **Computed availability** | Bookable times are derived per request by intersecting business hours, staff working hours, approved time off, existing appointments plus buffers, and room conflicts — never pre-generated as slot rows. |
| **Two resource pools** | An in-person service requires a qualified staff member *and* a free room for the full duration. Most booking tools model only one resource per booking. |
| **Deliberate time handling** | Working hours stored as local wall time plus zone ID; appointments in UTC. 2pm remains 2pm across a DST transition, and tenants in different regions do not share a constant offset. |
| **Race-free reservation** | Check-then-insert has a race window. Reservation is enforced by a Postgres exclusion constraint, so two concurrent requests for the same slot produce exactly one booking and one clean error. |
| **Structural tenant isolation** | Enforced below the query layer rather than by a `WHERE tenant_id = ?` a developer can forget, with a test proving cross-tenant reads fail. |

Detailed write-ups live in [`docs/`](docs/).

## Architecture

```mermaid
flowchart LR
  A[Public booking page] --> C[REST API]
  B[Staff & owner console] --> C
  C --> D[Availability engine]
  C --> E[Booking service]
  D --> F[(PostgreSQL)]
  E --> F
  E --> G[Notification worker]
```

> _screenshot: staff calendar view_

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Node 20, TypeScript, Express |
| Database | PostgreSQL 18, `node-pg-migrate`, `pg` |
| Frontend | React 19, TypeScript, Vite, TanStack Query, Tailwind |
| Testing | Vitest, Supertest, dedicated test database |
| Infrastructure | Docker Compose, GitHub Actions, AWS |

## Getting started

**Prerequisites:** Node 20+, Docker

```bash
git clone https://github.com/itsseanez/whiteboard.git
cd whiteboard
cp .env.example .env
```

Open `.env` and set real values for `WHITEBOARD_APP_PASSWORD` and `WHITEBOARD_SIGNUP_PASSWORD` — these are used to create dedicated, permission-scoped Postgres roles during migration. Make sure `APP_DATABASE_URL` and `SIGNUP_DATABASE_URL` use the same passwords you set above; the migration and the connection string are not yet linked automatically.

```bash
docker compose up -d          # PostgreSQL on :5432

cd backend
npm install
npm run migrate up            # apply migrations, including creating app-specific DB roles
npx tsx scripts/seed-auth.ts  # create demo users + organizations, link to seeded tenants
npm run dev                   # API on :3000

cd ../frontend
npm install
npm run dev                   # UI on :5173
```

Seed data creates two demo tenants in different timezones.

## Status

In active development since August 2026.

- [ ] Tenancy, authentication, roles, core model, deployed
- [ ] Availability engine
- [ ] Booking flow, public page, concurrency
- [ ] Calendars, reschedule, cancel, notifications, audit trail
- [ ] Hardening, API docs, demo tenants

## License

[MIT](LICENSE)