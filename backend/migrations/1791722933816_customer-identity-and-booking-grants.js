// Two things the booking write path needs: a way to recognise a returning
// customer, and write privileges for whiteboard_public.
//
// CUSTOMER IDENTITY
//
// appointment.customer_id is NOT NULL, so booking has to resolve a customer
// first. Without a unique constraint, "Alice books again next month" means a
// second customer row, and the appointment history that makes a returning
// customer worth anything is split across both.
//
// The key is (tenant_id, lower(email)):
//
//   · tenant_id, because two salons may each have their own Alice and neither
//     should see the other's. It also keeps the key inside the RLS boundary.
//   · lower(email), because Alice@example.com and alice@example.com are one
//     person and a customer typing either should land on one row. Done in the
//     database rather than in the service, so no future code path can bypass
//     it — the same reasoning as every other invariant here.
//
// It has to be a unique INDEX rather than a unique CONSTRAINT, because Postgres
// constraints cannot be defined over an expression. ON CONFLICT infers it by
// repeating the expression: ON CONFLICT (tenant_id, lower(email)).
//
// Accepted cost: two people sharing an email address share a customer record.
// For a salon booking page that is the right trade — the alternative is a new
// row per booking and no history at all.
//
// WRITE PRIVILEGES
//
// whiteboard_public handles all public-facing database access, so it gets the
// booking INSERTs rather than a separate role. Still column-scoped:
//
//   · status is NOT granted. A customer cannot book anything but the default
//     'BOOKED' — no self-service COMPLETED, no inserting a CANCELLED row to
//     occupy a slot invisibly.
//   · blocked is generated, so it cannot be inserted at all and needs no
//     grant. The buffers come from the service row, never from the request.
//   · UPDATE (phone) on customer only, for the upsert. A returning customer
//     may add or correct a phone number; nobody can overwrite the name on a
//     record they merely know the email address of.
//   · SELECT (id) on appointment, because INSERT ... RETURNING id needs read
//     privilege on what it returns.
//
// SELECT (id, tenant_id, email, phone) ON customer — A DELIBERATE WIDENING
//
// ON CONFLICT cannot be used without it. Verified by granting one column at a
// time: the arbiter inference reads tenant_id and email, and SET phone = ...
// reads phone. Even ON CONFLICT DO NOTHING is refused with SELECT (id) alone.
// There is no formulation of the upsert that avoids it.
//
// So the public role can read this tenant's customer emails and phone numbers.
// Accepted, with the reasoning written down because it looks careless
// otherwise:
//
//   · It is only reachable through SQL injection or a logic bug in a
//     public-path query. Every query in that path is parameterized and no
//     public endpoint returns a customer row — those two properties, not this
//     grant list, are what protect the data. Both belong in a test.
//   · It does not widen a host compromise at all: anyone who can read .env has
//     APP_DATABASE_URL in the same file, and whiteboard_app reads every column.
//   · RLS contains the bad case to one tenant. app.tenant_id comes from the
//     requested slug, so an injection against /studio-wien reads Studio Wien's
//     customers and nobody else's.
//   · appointment.customer_id stays withheld, so the correlation — who sat in
//     the chair, and when — is still unavailable. That is the leak worth
//     caring about, and it remains closed.

exports.up = (pgm) => {
  pgm.sql(`
    -- Fail loudly if the data cannot satisfy the key, naming the offenders.
    DO $$
    DECLARE dupes text;
    BEGIN
      SELECT string_agg(format('%s (%s rows)', email, n), ', ') INTO dupes
      FROM (
        SELECT min(email) AS email, count(*) AS n
        FROM customer
        GROUP BY tenant_id, lower(email)
        HAVING count(*) > 1
      ) d;
      IF dupes IS NOT NULL THEN
        RAISE EXCEPTION
          'Cannot migrate: duplicate customer email(s) within a tenant: %. Merge them before migrating.', dupes;
      END IF;
    END $$;

    CREATE UNIQUE INDEX customer_tenant_email_key ON customer (tenant_id, lower(email));

    -- Read: the booking page needs the service's own fields to price and
    -- describe the slot, which the availability grants already cover. These are
    -- the writes.
    GRANT INSERT (tenant_id, name, email, phone) ON customer TO whiteboard_public;
    GRANT UPDATE (phone) ON customer TO whiteboard_public;
    -- The four columns ON CONFLICT demands. See the note above. The name
    -- column is pointedly not among them.
    GRANT SELECT (id, tenant_id, email, phone) ON customer TO whiteboard_public;

    GRANT INSERT (
      tenant_id, staff_id, service_id, resource_id, customer_id,
      starts_at, ends_at, blocked_starts_at, blocked_ends_at
    ) ON appointment TO whiteboard_public;
    GRANT SELECT (id) ON appointment TO whiteboard_public;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE INSERT (
      tenant_id, staff_id, service_id, resource_id, customer_id,
      starts_at, ends_at, blocked_starts_at, blocked_ends_at
    ) ON appointment FROM whiteboard_public;

    REVOKE SELECT (id) ON appointment FROM whiteboard_public;
    REVOKE SELECT (id, tenant_id, email, phone) ON customer FROM whiteboard_public;
    REVOKE UPDATE (phone) ON customer FROM whiteboard_public;
    REVOKE INSERT (tenant_id, name, email, phone) ON customer FROM whiteboard_public;

    DROP INDEX customer_tenant_email_key;
  `);
};
