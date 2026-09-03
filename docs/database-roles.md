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
| `whiteboard` | Owner. Runs migrations, DDL, admin work. Also the role Better Auth's own `Pool` connects as (see below). | Yes (superuser) | Docker's `POSTGRES_USER`, not a migration |
| `whiteboard_app` | Authenticated app queries — staff/owner routes under `/tenant/:slug`, resolved via session. The only role subject to `app.tenant_id`/`app.user_id`-based RLS. | No | Migration (guarded) |
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

### Three environments, not two

With hosting on EC2 there are now three sets of connection strings, not two:

| Environment | Database | Where the values live |
|---|---|---|
| Local dev | `whiteboard` on the Docker Postgres | `backend/.env` |
| Test | `whiteboard_test`, same local cluster | `backend/.env.test` |
| Production | `whiteboard` in the Postgres container on the EC2 box | `backend/.env` on the server |

Roles are still cluster-wide *within* a cluster — but the EC2 box is a
separate cluster from the local one, so all three app roles have to be
created there too. They will be, since the same guarded `CREATE ROLE`
migrations run on first deploy. The passwords are not shared between
clusters and should not be.

The production `.env` never enters git. `.env` was tracked in early
commits on this repo once already and required `git filter-repo` on a
fresh clone to remove. Decide deliberately whether it is placed on the
box by hand or injected from GitHub Actions secrets at deploy time, and
make sure no workflow step can echo it into a build log.

**`.env.test` must define all four connection strings, not just the three
app-facing ones.** `auth.ts` reads `DATABASE_URL` directly for its own
connection (see below) — if it's missing from `.env.test`, Better Auth
silently falls back to dev's `DATABASE_URL` while the rest of the app
correctly talks to `whiteboard_test`, producing confusing "user not found"
/ "tenant not found" errors that look like data problems but are actually
two different databases being queried in the same request.

## Pools in code

Each role has its own `pg.Pool` instance in `db.ts`, built from its
connection string:

| Pool | Env var | Used in |
|---|---|---|
| `appPool` | `APP_DATABASE_URL` | `routes/tenant` services, behind `resolveTenantFromSession` |
| `signupPool` | `SIGNUP_DATABASE_URL` | Tenant signup/provisioning |
| `publicPool` | `PUBLIC_DATABASE_URL` | `routes/public` services, behind `resolveTenantFromSlug` |

No other pool should ever connect using a role outside its intended
purpose — e.g. `publicPool` should never be imported from a `/tenant/:slug`
route.

**`auth.ts` builds a fourth, separate `Pool` of its own, directly from
`DATABASE_URL`** — independent of `db.ts` entirely. Better Auth's tables
(`user`, `session`, `organization`, `member`) have no RLS policies applied,
so this pool running as the owner role isn't currently unsafe, but it does
mean there are two independent places in the codebase that decide which
database to talk to. Keeping them in sync (e.g. across `.env` vs
`.env.test`) is a manual responsibility, not something enforced by the
code — this already caused a real bug once during test setup.

This gets worse with production in the picture. On the server there is no
convenient `psql` prompt to sanity-check which database answered, so the
same silent divergence surfaces as "tenant not found" against a box you
have to SSH into to diagnose. Worth collapsing `auth.ts` onto a pool from
`db.ts` before first deploy rather than after.

## Session variables (RLS context)

Two session variables drive row visibility for `whiteboard_app`:

- **`app.tenant_id`** — set whenever a request already has a resolved
  tenant. Used by the isolation policies on `staff`, `service`, `resource`,
  `customer`, `appointment`, and the tenant-id-match branch of `tenant`'s
  own policy.
- **`app.user_id`** — set specifically to resolve *which* tenant a session
  can access in the first place, before any `tenant_id` exists to scope by
  (e.g. `getTenantBySlug`'s authenticated branch, `getTenantsByUserId`).
  Backs the membership-`EXISTS` branch of `tenant_select_app`.

Both are set via `SELECT set_config($1, $2, true)`, not raw
`SET LOCAL name = $1` — Postgres's `SET`/`SET LOCAL` syntax does not accept
bind parameters, so a parameterized `SET LOCAL` call fails outright.
`set_config`'s third argument (`true`) makes it transaction-scoped,
equivalent to `SET LOCAL`, but callable as an ordinary parameterized query.

`withContext.ts` is the single shared wrapper that opens a transaction,
calls `set_config` for whichever of `tenantId`/`userId` are provided, runs
the query, and commits/rolls back. Every tenant-scoped service call should
go through it rather than setting session variables by hand.

## Current grants

**`whiteboard_app`**
- `CONNECT` on database `whiteboard`, `USAGE` on schema `public`
- `SELECT, INSERT, UPDATE, DELETE` on all tables currently in `public`
- `ALTER DEFAULT PRIVILEGES FOR ROLE whiteboard IN SCHEMA public` — any
  table `whiteboard` creates in a future migration automatically grants
  the same four privileges to `whiteboard_app`, with no separate grant
  needed per new table
- On `tenant` specifically, visibility is further restricted by the
  `tenant_select_app` RLS policy (see below) — the blanket grant above is
  necessary but not sufficient for reading `tenant` rows

**`whiteboard_signup`**
- `CONNECT` on database `whiteboard`, `USAGE` on schema `public`
- `INSERT` on `tenant` only — nothing else

**`whiteboard_public`**
- `SELECT (id, slug, timezone)` on `tenant` only — column-scoped, read-only,
  no session variable required (this is the anonymous slug-lookup path)

## RLS policies on `tenant`

- **`tenant_select`** — `TO whiteboard_public, whiteboard_signup` only
  (narrowed from an original unrestricted `USING (true)`). Anonymous slug
  lookups and signup provisioning still see every tenant unrestricted;
  `whiteboard_app` is deliberately excluded from this policy.
- **`tenant_select_app`** — `TO whiteboard_app` only. Allows a row through
  if either `id = current_setting('app.tenant_id', true)::uuid` (tenant
  already resolved), or an `EXISTS` check finds a `member` row linking
  `current_setting('app.user_id', true)` to that row's `better_auth_org_id`
  (tenant not yet resolved — the bootstrapping case). Both `current_setting`
  calls use the two-argument form so an unset variable evaluates to `NULL`
  rather than throwing, letting the `OR` fall through cleanly.
- `tenant_insert`, `tenant_update`, `tenant_delete` — unchanged from
  initial design, scoped `TO whiteboard_signup` (insert) or by
  `app.tenant_id` match (update/delete).

Verified manually via `SET ROLE whiteboard_app` + `SET LOCAL` inside a
transaction, against real seeded data, for all four cases: direct
`tenant_id` match, membership-only match, a user with zero memberships,
and neither variable set (fails closed — zero rows, no thrown error).

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