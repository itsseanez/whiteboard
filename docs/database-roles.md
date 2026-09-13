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
    EXECUTE format('CREATE ROLE whiteboard_app WITH LOGIN PASSWORD %L', $pw$...$pw$);
  END IF;
END
$$;
```

Without the guard, replaying migrations against a second database
(`whiteboard_test`) fails with "role already exists" — the role is already
there cluster-wide, but the `GRANT`/RLS-policy statements after it still
need to run fresh, since those are scoped to that one database.

The same asymmetry breaks `down` migrations on role files. `DROP ROLE`
fails if the role still holds privileges in *any* database in the cluster,
so revoking in `whiteboard` is not enough while `whiteboard_test` still has
grants. Role `down` migrations are close to decorative for this reason;
recovery is rebuild-from-`migrate up`, not rollback.

**Lesson learned the hard way:** `docker compose down -v` doesn't just
reset one database — it destroys the entire cluster's data directory,
wiping every role and every database in it at once. All three app roles
were unguarded when this happened once during setup, which is how the gap
got caught. If you ever need to force a clean re-init, expect to rebuild
dev (`npm run migrate up` + reseed) immediately after, not just the
database you meant to reset. On the EC2 box that command is forbidden
outright — see `DECISIONS.md`.

## Migrations must not hardcode environment names

Two bugs of the same shape, both found by CI on a fresh cluster, both of
which would have run clean in production and stayed latent:

- `GRANT CONNECT ON DATABASE whiteboard` names a database that only exists
  locally and on the server. Use dynamic SQL with `current_database()`.
- `ALTER DEFAULT PRIVILEGES FOR ROLE whiteboard` names the owner role
  literally. Use `current_user`.

```sql
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO whiteboard_app', current_database());
END
$$;
```

`GRANT USAGE ON SCHEMA` and table-level grants operate inside the current
database and need no name.

Role passwords come from env vars and must never be interpolated straight
into SQL — a password containing a quote breaks out of the string literal.
Use `format(...%L...)` with a dollar-quoted tag, and throw in JS if the env
var is unset, so a missing value fails loudly instead of creating a role
with the literal password `undefined`.

## Roles

| Role | Purpose | Bypasses RLS | Created by |
|---|---|---|---|
| `whiteboard` | Owner. Runs migrations, DDL, admin work. | Yes (superuser) | Docker's `POSTGRES_USER`, not a migration |
| `whiteboard_app` | Authenticated app queries — staff/owner routes under `/tenant/:slug`, resolved via session. The only role subject to `app.tenant_id`/`app.user_id`-based RLS. | No | Migration (guarded) |
| `whiteboard_signup` | Tenant provisioning/signup flow. Insert-only. | No | Migration (guarded) |
| `whiteboard_public` | Anonymous public routes — slug-based tenant lookup, eventually public booking reads/inserts. | No | Migration (guarded) |
| `whiteboard_auth` | Better Auth's own queries — sessions, users, credentials, organizations. Scoped to the seven auth tables only. | No | Migration (guarded) |

Confirmed via `\du`: only `whiteboard` shows `Bypass RLS` — the four
app-facing roles do not, which is the point of having them separate from
the owner.

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
| `whiteboard_auth` | `WHITEBOARD_AUTH_PASSWORD` | `AUTH_DATABASE_URL` |

`TEST_DATABASE_URL` connects as `whiteboard` (the owner role) against
`whiteboard_test` — migrations always run as owner, regardless of which
database they're targeting. `migrate:test` reads it via
`node-pg-migrate -d TEST_DATABASE_URL`, where `-d` names the *env var*,
not a database.

The password baked into `CREATE ROLE` by the migration and the password
inside that role's connection string are two separate values that must
match by hand. Nothing enforces it. This is the single most common cause
of a migration that succeeds followed by an authentication failure.

### Adding a new role means five places, not four

1. `backend/.env`
2. `backend/.env.test` (same role and password, database `whiteboard_test`)
3. The CI workflow's job-level `env:` block
4. `backend/.env.example` — key names only, no values. This is the only
   record of what a fresh `.env` needs, and it is the one people skip.
5. SSM Parameter Store under `/whiteboard/prod/`, plus the count check in
   the deploy fetch script

CI runs migrations against a fresh cluster on every push, so a missed
entry surfaces there with a clean error rather than on the server.

### Four environments

| Environment | Database | Where the values live |
|---|---|---|
| Local dev | `whiteboard` on the Docker Postgres | `backend/.env` |
| Test | `whiteboard_test`, same local cluster | `backend/.env.test` |
| CI | ephemeral `whiteboard_test` in a service container | job-level `env:` in the workflow |
| Production | `whiteboard` in the Postgres container on EC2 | `backend/.env` on the server, written from Parameter Store |

Roles are cluster-wide *within* a cluster — but the EC2 box is a separate
cluster from the local one, so all four app roles are created there too by
the same guarded migrations on first deploy. Passwords are not shared
between clusters.

In production the connection strings use host `postgres`, not `localhost`
— inside a container, `localhost` is that container. The database is a
separate container reached by compose service name.

The production `.env` never enters git. `.env` was tracked in early
commits on this repo once already and required `git filter-repo` on a
fresh clone to remove. It is written on the box by the deploy step from
Parameter Store and exists nowhere else.

## No TLS on database connections

App and Postgres are containers on the same host, talking over Docker's
private bridge network; traffic never reaches a network interface anyone
can reach. The stock `postgres:18` image has no TLS configured, so
requiring it would break every connection.

An earlier `ssl: isProd ? true : false` in `db.ts` was a leftover from the
September Neon detour and would have failed every production connection
the moment `NODE_ENV=production` was set. Removed.

**This assumption breaks the moment Postgres moves off the box.**
Re-examine before any such move.

## Pools in code

Each role has its own `pg.Pool` instance in `db.ts`, built from its
connection string:

| Pool | Env var | Used in |
|---|---|---|
| `appPool` | `APP_DATABASE_URL` | `routes/tenant` services, behind `resolveTenantFromSession` |
| `signupPool` | `SIGNUP_DATABASE_URL` | Tenant signup/provisioning |
| `publicPool` | `PUBLIC_DATABASE_URL` | `routes/public` services, behind `resolveTenantFromSlug` |
| `authPool` | `AUTH_DATABASE_URL` | `auth.ts` only — passed to `betterAuth({ database })` |

No pool should ever connect using a role outside its intended purpose —
e.g. `publicPool` should never be imported from a `/tenant/:slug` route.

`auth.ts` previously constructed its own `Pool` inline from `DATABASE_URL`,
independent of `db.ts` — meaning two places in the codebase decided which
database to talk to, kept in sync only by hand. That produced "user not
found" errors that looked like data problems but were two different
databases being queried in the same request, once locally and once in CI.
It also meant Better Auth — which reads and writes password hashes in
`account` and validates a session on every authenticated request — ran as
the owner role, bypassing RLS on every table in the database.

Resolved: `auth.ts` imports `authPool` from `db.ts`. One place decides.

**`dotenv` is loaded once, at the entry point (`src/server.ts`), and never
in library modules.** Import order matters — any module that constructs a
Pool at load time reads an empty `process.env` if dotenv has not run yet.
If that ever bites, the fix is a small `config.ts` that loads dotenv and
exports validated values.

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
- `CONNECT` on the current database, `USAGE` on schema `public`
- `SELECT, INSERT, UPDATE, DELETE` on all tables currently in `public`
- `ALTER DEFAULT PRIVILEGES` for the owner role in schema `public` — any
  table created in a future migration automatically grants the same four
  privileges, with no separate grant needed per new table
- On `tenant` specifically, visibility is further restricted by the
  `tenant_select_app` RLS policy — the blanket grant is necessary but not
  sufficient for reading `tenant` rows

**`whiteboard_signup`**
- `CONNECT` on the current database, `USAGE` on schema `public`
- `INSERT` on `tenant` only — nothing else

**`whiteboard_public`**
- `SELECT (id, slug, timezone)` on `tenant` only — column-scoped, read-only,
  no session variable required (this is the anonymous slug-lookup path)

**`whiteboard_auth`**
- `CONNECT` on the current database, `USAGE` on schema `public`
- `SELECT, INSERT, UPDATE, DELETE` on exactly seven tables:
  `"user"`, `"session"`, `account`, `verification`, `organization`,
  `member`, `invitation`
- **Deliberately no `ALL TABLES` grant and no `ALTER DEFAULT PRIVILEGES`.**
  Tables added in later phases must not become automatically visible to
  this role. `"user"` requires quoting — reserved word.
- No access to any domain table (`tenant`, `staff`, `service`, `resource`,
  `customer`, `appointment`, `staff_service`) or to `pgmigrations`

The auth tables are seven, not four — `account` (which holds password
hashes for email/password auth), `verification`, and `invitation` come
from Better Auth and its organization plugin. `invitation` exists because
the organization plugin enables invite flows; nothing uses it yet and it
has no RLS policy.

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

## Open design questions

**Blanket `DELETE` on the future audit table.** `whiteboard_app`'s grant
includes `DELETE` on every table in `public`, including whatever
audit-trail table gets built later, and `ALTER DEFAULT PRIVILEGES` means
it will be granted automatically. The scope doc requires every appointment
state change to be auditable — a blanket `DELETE` means an application bug
could delete an audit row as easily as a stale appointment. Decide once
that table exists: either `REVOKE DELETE` on it specifically (append-only
at the database level) or accept the risk knowingly.

**`whiteboard_app` depends on `SELECT ON member`, undocumented until now.**
The `tenant_select_app` policy's `EXISTS` branch reads `member`, evaluated
in `whiteboard_app`'s context. It currently works via the blanket
`ALL TABLES` grant. If that grant is ever narrowed — which the audit-table
question above may force — `SELECT ON member` must be granted explicitly,
or tenant resolution silently returns zero rows for every user whose tenant
is not already resolved. Silent, not an error.

## Known gaps / not yet granted

- `whiteboard_public` will need read access to `staff`, `service`, and
  `resource` (for the public availability view), and insert access on
  `appointment` (for public booking) — planned for weeks 3–8 per the
  project timeline, not granted yet.
- `invitation` has no RLS policy and no route using it.