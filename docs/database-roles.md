# Database roles

Reference for the Postgres roles in use, what each is scoped to do, and how
each maps to an env var and a connection pool in code. See `DECISIONS.md`
for why the app uses separate roles instead of one shared connection.

## Cluster vs. database scope

Roles are cluster-wide — a role's *existence* is shared across every
database in the same Postgres instance (`whiteboard`, `whiteboard_test`).
A role's *privileges on specific tables* are not — those are granted
per-database, since the tables themselves are separate objects in each
database.

This is why every `CREATE ROLE` migration is wrapped in a guard:

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'whiteboard_app') THEN
    CREATE ROLE whiteboard_app WITH LOGIN PASSWORD '${password}';
  END IF;
END
$$;
```

Without the guard, replaying migrations against a second database
(`whiteboard_test`) fails with "role already exists" — the role is already
there cluster-wide, but the `GRANT`/RLS-policy statements after it still
need to run fresh, since those are scoped to that one database.

**Lesson learned the hard way:** `docker compose down -v` doesn't just
reset one database — it destroys the entire cluster's data directory,
wiping every role and every database in it at once. All three app roles
were unguarded when this happened once during setup, which is how the gap
got caught. If you ever need to force a clean re-init, expect to rebuild
dev (`npm run migrate up` + reseed) immediately after, not just the
database you meant to reset.

## Roles

| Role | Purpose | Bypasses RLS | Created by |
|---|---|---|---|
| `whiteboard` | Owner. Runs migrations, DDL, admin work. | Yes (superuser) | Docker's `POSTGRES_USER`, not a migration |
| `whiteboard_app` | Authenticated app queries — staff/owner routes under `/api`, resolved via session. | No | Migration (guarded) |
| `whiteboard_signup` | Tenant provisioning/signup flow. Insert-only. | No | Migration (guarded) |
| `whiteboard_public` | Anonymous public routes — slug-based tenant lookup, eventually public booking reads/inserts. | No | Migration (guarded) |

Confirmed via `\du` against `whiteboard_test`: only `whiteboard` shows
`Bypass RLS` — the three app-facing roles do not, which is the point of
having them separate from the owner.

## Env vars and connection strings

Each role has its own password env var and its own full connection string.
Only the database name at the end should differ between an app role's
normal string and its test-database equivalent — the role and password
stay the same, since roles are cluster-wide.

| Role | Password env var | Connection string env var |
|---|---|---|
| `whiteboard` | `POSTGRES_PASSWORD` (root `.env`) | `DATABASE_URL` |
| `whiteboard_app` | `WHITEBOARD_APP_PASSWORD` | `APP_DATABASE_URL` |
| `whiteboard_signup` | `WHITEBOARD_SIGNUP_PASSWORD` | `SIGNUP_DATABASE_URL` |
| `whiteboard_public` | `WHITEBOARD_PUBLIC_PASSWORD` | `PUBLIC_DATABASE_URL` |

`TEST_DATABASE_URL` connects as `whiteboard` (the owner role) against
`whiteboard_test` — migrations always run as owner, regardless of which
database they're targeting.

## Pools in code

Each role has its own `pg.Pool` instance in `db.ts`, built from its
connection string:

| Pool | Env var | Used in |
|---|---|---|
| `appPool` | `APP_DATABASE_URL` | `routes/api` services, behind `resolveTenantFromSession` |
| `signupPool` | `SIGNUP_DATABASE_URL` | Tenant signup/provisioning |
| `publicPool` | `PUBLIC_DATABASE_URL` | `routes/public` services, behind `resolveTenantFromSlug` |

No other pool should ever connect using a role outside its intended
purpose — e.g. `publicPool` should never be imported from an `/api` route.

## Current grants

**`whiteboard_app`**
- `CONNECT` on database `whiteboard`, `USAGE` on schema `public`
- `SELECT, INSERT, UPDATE, DELETE` on all tables currently in `public`
- `ALTER DEFAULT PRIVILEGES FOR ROLE whiteboard IN SCHEMA public` — any
  table `whiteboard` creates in a future migration automatically grants
  the same four privileges to `whiteboard_app`, with no separate grant
  needed per new table

**`whiteboard_signup`**
- `CONNECT` on database `whiteboard`, `USAGE` on schema `public`
- `INSERT` on `tenant` only — nothing else

**`whiteboard_public`**
- `SELECT (id, slug, timezone)` on `tenant` only — column-scoped, read-only,
  no session variable required (this is the anonymous slug-lookup path)

## Open design question, not yet decided

`whiteboard_app`'s blanket grant includes `DELETE` on every table in
`public`, including whatever audit-trail table gets built later. The
scope doc requires every appointment state change to be auditable — a
blanket `DELETE` grant means an application bug could delete an audit
row as easily as a stale appointment. Worth deciding deliberately once
that table exists: either `REVOKE DELETE` on it specifically (making it
append-only at the database level) or accept the risk knowingly. Not
blocking anything today since the table doesn't exist yet.

## Known gaps / not yet granted

- `whiteboard_public` will need read access to `staff`, `service`, and
  `resource` (for the public availability view), and insert access on
  `appointment` (for public booking) — planned for weeks 3–8 per the
  project timeline, not granted yet.