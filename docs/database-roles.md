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
- Per table, exactly what the code does (narrowed 6 Nov 2026; until then it
  had all four privileges on every table, Better Auth's included):

  | Table | Privileges |
  |---|---|
  | `tenant`, `organization`, `member` | `SELECT` |
  | `staff`, `service`, `resource` | `SELECT, INSERT, UPDATE` (a delete is an archive) |
  | `staff_service`, `service_resource`, `staff_working_hours`, `business_hours` | `SELECT, INSERT, DELETE` (replaced as a set) |
  | `time_off` | `SELECT` |
  | `customer`, `appointment` | `SELECT, INSERT, UPDATE` |
  | `invitation` | `SELECT` (accepting decides from the row) |

- Nothing on `account`, `session`, `user`, `verification` or `pgmigrations`.
- **No default privileges.** A table created by a later migration gives
  `whiteboard_app` nothing until that migration grants it.
- `SELECT ON member` is load-bearing: `tenant_select_app`'s membership branch
  reads it as `whiteboard_app`. Without it, tenant resolution returns zero rows
  for every user, silently.
- `tests/app-role-grants.test.ts` checks all of this.

**`whiteboard_signup`**
- `CONNECT` on the current database, `USAGE` on schema `public`
- `INSERT` on `tenant` only — nothing else

**`whiteboard_public`**
- `SELECT (id, slug, timezone)` on `tenant` only — column-scoped, read-only,
  no session variable required (this is the anonymous slug-lookup path)
- `SELECT (customer_id)` on `appointment`, so a cancel or move made from a
  manage link can email that appointment's customer. It could already read
  `customer.email`; this only follows the link, and the routes use it only
  for an appointment whose token the caller presented.

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
from Better Auth and its organization plugin. `invitation` holds staff and
manager invitations, with a `staffId` column for the staff row an invitation
is for. It has no RLS policy: its id is the secret in the emailed link, and
the app only reads it by id.

## RLS by role, for `whiteboard_app`

On `appointment`, `customer` and `staff_working_hours`, the original
tenant-only policies now apply to `whiteboard_public` alone, and
`whiteboard_app` gets its own, which also look at who the caller is. Two
functions read the session variables:

- **`app_caller_manages()`** — is the `app.user_id` caller an `owner` or
  `admin` member of the `app.tenant_id` tenant?
- **`app_caller_staff_id()`** — the caller's own staff row in that tenant,
  or `NULL` if they have none or it is archived.

Both are wrapped as `(SELECT …)` in the policies so Postgres runs them once
per query rather than once per row.

| Table | Read | Write |
|---|---|---|
| `appointment` | manager, or `staff_id` is the caller's own | managers only |
| `customer` | manager, or has an appointment with the caller | managers only |
| `staff_working_hours` | anyone in the tenant | manager, or the caller's own rows |

So every `whiteboard_app` call that touches these tables sets both
`tenantId` and `userId` in `withContext`; the services take a `Scope` for
that. A call with no user set reads zero rows and writes nothing, which is
the failure the policies are built to have. The public booking path keeps
reading every appointment in the tenant, because availability needs them,
and never returns customer details. `tests/staff-accounts.test.ts` proves
the staff boundary directly against the database.

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

**The future audit table.** With no default privileges, the migration that
creates it decides what `whiteboard_app` gets. Grant `SELECT, INSERT` only, so
the table is append-only at the database level.

## Known gaps / not yet granted

- **`whiteboard_public` can write any status, not just `CANCELLED`.**
  Cancel needs `UPDATE (status)` on `appointment`, and column privileges are
  all-or-nothing per column, so the grant also permits `COMPLETED` and
  `NO_SHOW`. The `appointment_status_check` keeps the set closed and the
  application only ever parameterizes the literal `'CANCELLED'`, so nothing
  reachable through the API can do otherwise. It adds no practical reach for
  an attacker either — all three statuses free the slot identically, so the
  ability to write one is the ability to achieve the only effect that matters.
  The real fix is a `WITH CHECK` on the public role's RLS policy restricting
  the status it may write. Not done, because the current policies have no
  `WITH CHECK` at all and adding one needs its own pass over every write path.

- **`appointment.service_id` is now readable by `whiteboard_public`.**
  Withheld originally; reschedule needs it to re-run availability against the
  right service, and it cannot be taken from the request without letting a
  caller validate against the wrong duration and opening rules.
  `appointment.customer_id` stays withheld, so the correlation between a
  person and a visit — the part worth protecting — is still closed.

- **The manage-token lookup requires `SELECT (manage_token_hash)`.**
  Postgres needs `SELECT` on every column named in a `WHERE` clause, so the
  public role can read this column. It holds sha256 digests of 32 random
  bytes, never plaintext tokens, which is specifically why the grant is
  uninteresting. The tighter alternative — a `SECURITY DEFINER` function
  doing the lookup, with no `SELECT` on the column at all — was not taken
  because such a function bypasses RLS and would have to re-apply the tenant
  filter itself. Worth doing deliberately; not worth doing incidentally.

- `invitation` has no RLS policy and no route using it.

> The **Current grants** section above predates the availability, booking and
> manage-token migrations and no longer lists everything `whiteboard_public`
> holds. `\dp appointment` in psql is the authority until it is rewritten.