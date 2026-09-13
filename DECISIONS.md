# Whiteboard — settled decisions

Why the project is built the way it is. Closed unless something in the build
proves them wrong; reopen date October 1, 2026.

Infrastructure and deploy decisions live in [`docs/deployment.md`](docs/deployment.md).
The database role model is in [`docs/database-roles.md`](docs/database-roles.md).

## Product

- **Domain: salon / independent service business booking.** Chosen over restaurant reservations, which is a different algorithm — table-fitting rather than constraint intersection — and over systems projects (Raft, a workflow engine, a storage engine), which have a higher ceiling but a worse fit for a bounded build.
- **Positioning: sold as salon software, built as a general engine.** The data model contains no salon-specific concepts — `staff`, `service`, `resource`, `appointment`. The same schema serves a tattoo studio, a physio clinic, or a dog groomer unmodified. Salon vocabulary lives in UI copy and seed data only. No label-customization feature: generic names in code, salon words in copy.
- **Model rule:** a concept enters the schema only if it exists in at least three candidate verticals. Staff qualifications, service durations, buffers, and room constraints qualify. Walk-in queues, product retail, and chair rental do not.
- **Not a commercial product.** This is a portfolio artifact. The market has capable free incumbents, and a live customer would mean production obligations the project isn't structured to meet.

## Stack

- **TypeScript / Node / Express.**
- **Node 26.** Node 20 reached end of life on 30 April 2026 and receives no security patches — a non-starter for a process that parses untrusted input from the public internet. Node 24 is the Active LTS today but moves to Maintenance on 20 October 2026; Node 26 becomes Active LTS on 28 October and runs to April 2029. It also matches the local dev version and `@types/node`, which removes a class of bug where code typechecks against APIs the runtime doesn't have. Accepted tradeoff: less ecosystem soak time than an established LTS line. Pinned in the Dockerfile, the CI workflow, and `engines`.
- **Separate API + Vite/React frontend, not Next.js.** The REST API with webhooks is a first-class deliverable, and reminder emails need a long-running scheduler rather than a request-scoped one.
- **Express over NestJS.** Multi-tenancy, timezone-correct scheduling, and database-level constraints are enough new concepts without a framework to learn alongside them.
- **PostgreSQL 18**, with `node-pg-migrate`. **Migrations are the schema; the database is their output.** `node-pg-migrate` lives in `dependencies`, not `devDependencies` — the production container executes it as a one-shot migrate service, so it is a runtime dependency regardless of feeling like tooling.
- **Compiled with `tsc`, not run through `tsx` in production.** `tsx` transpiles without typechecking, so for a while nothing had ever checked this codebase. Two configs: `tsconfig.json` builds `src/` to `dist/`; `tsconfig.check.json` extends it with `noEmit`, a root of `.`, and a wider `include` covering tests, scripts, and config. `build` compiles what ships; `typecheck` checks what should be correct. CI runs both.
- **Scheduler runs in-process, not as an external cron.** A long-running instance removes the constraint that pushed reminder emails toward a scheduled CI job, which was the original argument for a separate API in the first place.

## Architecture

- **Availability is computed, never stored.** Bookable times are derived per request by intersecting business hours, staff working hours, approved time off, existing appointments plus buffers, and resource conflicts. No pre-generated slot rows.
- **Invariants live in the database, not application code.** Booking races are prevented by a Postgres exclusion constraint on `(staff_id =, during &&)` via `btree_gist`, so the check and the write are one atomic operation. Check-then-insert has a race window; this does not.
- **Tenant isolation is enforced below the query layer**, by row-level security with a session variable — not by a `WHERE tenant_id = ?` a developer can forget. A test proves cross-tenant reads fail.
- **One database role per access path, none of them the owner.** `whiteboard_app`, `whiteboard_signup`, `whiteboard_public`, `whiteboard_auth` — each scoped to what it needs, none bypassing RLS. Better Auth originally ran on an inline pool as the owner role, which meant password hashes and session validation bypassed RLS on every table in the database; it now has its own role scoped to seven tables and no domain access. See [`docs/database-roles.md`](docs/database-roles.md).
- **Migrations must not hardcode a database or role name.** `current_database()` and `current_user` via `format()`. Both bugs were found by CI running against a fresh cluster, and both would have run clean in production and stayed latent.
- **UUID primary keys** (`gen_random_uuid()` via pgcrypto). Sequential ids are enumerable, and appointment ids go in emailed links.
- **Time:** wall-clock rules (business hours, working hours) stored as local time plus an IANA zone id on the tenant. Appointment instants as `timestamptz`. Never a fixed offset like `+01:00` — offsets don't survive DST, and tenants in different regions don't shift on the same dates.
- **Schema hedges that cost nothing now:** a capacity column defaulting to 1, and staff nullable on appointment. Keeps group classes and resource-only booking possible later without a painful migration.

## Scope

**In:** tenant provisioning · staff, service, and resource management · working hours and time off · availability engine · public booking page per tenant · book, cancel, reschedule · staff and owner calendars · email notifications · appointment audit trail · REST API with webhooks.

**Out:** payments and deposits · recurring series · group bookings · waitlists · calendar sync · SMS · packages and loyalty · custom intake forms · reporting dashboards · walk-in queues · product retail · mobile apps · custom domains · label customization.

Several of those are how a commercial version would make money. None of them matter if availability is wrong.

**Parked until the core is done:** intelligent gap-filling — cancelled slots offered to waiting customers first-come-first-served, and slot scoring that prefers times packing the day tightly over ones stranding unusable gaps. Cheap on top of the existing engine, and it's the receptionist judgment the project's thesis is built on.

## Open — availability engine

Not yet settled. Each constrains everything built on top, so they get decided before the first interval function:

- **Where the computation lives.** All-SQL with range types and `range_agg`, all-TypeScript, or SQL fetching raw constraints with TypeScript doing the interval math. The definition of done requires explaining why a given slot did *not* appear, which argues for a pure function taking constraints as arguments and doing no I/O.
- **Time library.** `date-fns-tz` or Temporal.
- **Slot granularity.** Fixed grid, service-length steps, or anchored to existing appointments. This determines whether the parked gap-filling feature is a scoring problem or a structural one — a 15-minute grid creates the stranded gaps it would later be scoring against.
- **Buffer interaction.** Whether adjacent services' after- and before-buffers add or overlap. The answer is baked into the stored range, so it can't stay implicit.

## Phases

| Phase | Gate |
|---|---|
| Tenancy, auth, roles, core model, **deployed** | Two tenants live at a URL; a test proves neither can read the other |
| Availability engine | Correct slots from hours, time off, buffers, bookings, and resources — including across a DST boundary |
| Booking flow, public page, concurrency | Two simultaneous requests for one slot; exactly one wins |
| Calendars, reschedule, cancel, notifications, audit | A stylist sees their week; a customer reschedules from an email link |
| Hardening: seed data, API docs, demo tenants | A stranger books an appointment from the URL with no instructions |

**Deployed in phase one, not at the end.** An empty app was live at a real address over TLS, with an automated pipeline, before it did anything interesting.

**If behind:** cut resources (staff-only booking, no rooms). Never cut timezone correctness or the concurrency test.

## Definition of done

Sign up as a new salon. Add two stylists with awkward hours and one wash station. Define a service that needs the station and one that doesn't. Open the public page and book both.

Then explain why a particular time slot did not appear.