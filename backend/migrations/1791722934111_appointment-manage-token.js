// What a customer needs in order to cancel or reschedule from an email link,
// and the privileges whiteboard_public needs to honour it.
//
// WHY NOT JUST USE THE APPOINTMENT ID
//
// DECISIONS.md says appointment ids go in emailed links, and a v4 uuid is 122
// random bits, so using the id as the credential would "work". It is still the
// wrong shape: an identifier and a credential have opposite requirements. An
// identifier wants to be loggable, quotable in a support email, printable on a
// receipt and returnable from an API. A credential wants to exist in exactly
// one place. The moment the id is both, every access log and every Referer
// header is a list of live cancel tokens, and there is no way to revoke one
// without deleting the appointment.
//
// So the appointment keeps its id, and gets a separate credential.
//
// WHY THE COLUMN IS A HASH
//
// manage_token_hash stores sha256(token). The token itself is generated in the
// application, returned once in the booking response, and never stored — the
// database has never seen it and cannot leak it.
//
// This matters specifically because of column privileges. Looking an
// appointment up by its token means `WHERE manage_token_hash = $1`, and
// Postgres requires SELECT on every column named in a WHERE clause. So
// whiteboard_public must be able to read this column. If it held plaintext
// tokens, that grant would hand an attacker with any read primitive the
// ability to cancel every appointment in the tenant. Holding hashes, the same
// grant yields 32-byte sha256 digests of random input, which are not
// invertible and not brute-forceable. The grant becomes uninteresting, which
// is the point.
//
// Same reasoning as storing password hashes, applied to a capability URL.
//
// EXISTING ROWS
//
// Backfilled with the hash of bytes that are generated and immediately thrown
// away, so no token exists that matches them. Those appointments were booked
// before manage links existed and must not become manageable by accident; a
// nullable column would have been the alternative, but then every lookup needs
// a null guard and one forgotten guard means `WHERE manage_token_hash = NULL`
// quietly matching nothing — or, worse, a null token from the application
// matching a null row.
//
// THE ONE PRIVILEGE WIDENING: appointment.service_id
//
// 1791666461196 deliberately withheld it, on the grounds that the availability
// engine needs to know THAT a stylist is busy, never what for. Reschedule does
// need it: re-running availability requires the service's duration, buffers,
// minimum notice and qualified staff, and the service cannot be taken from the
// request — a caller who passed a different service's id would get an
// availability check against the wrong duration and opening rules, and could
// land an appointment the real service does not fit.
//
// What this costs, precisely: an attacker with a read primitive on the public
// path learns that some appointment at 14:00 is a colour. What it does not
// cost: who. appointment.customer_id stays withheld, so the correlation
// between a person and a visit — the thing actually worth protecting — remains
// closed.
//
// A TIGHTER OPTION I DID NOT TAKE
//
// Both this grant and the hash grant could be avoided with a SECURITY DEFINER
// function that takes a token hash and returns only the matching row's
// (id, service_id, staff_id, starts_at, status). whiteboard_public would get
// EXECUTE and no SELECT on either column.
//
// Not done here because SECURITY DEFINER runs as the owner and therefore
// BYPASSES RLS, so the function would have to re-apply the tenant filter
// itself from current_setting('app.tenant_id'). That is a new access path with
// RLS turned off inside it, which is a bigger architectural decision than this
// migration should make on its own — "one role per access path, none of them
// the owner" is a settled decision in DECISIONS.md and a definer function is a
// deliberate exception to it. Worth doing; worth doing on purpose.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE appointment ADD COLUMN manage_token_hash text;

    -- Unmatchable by construction: the preimage is generated inside the
    -- expression and never escapes it.
    UPDATE appointment
    SET manage_token_hash = encode(digest(gen_random_bytes(32), 'sha256'), 'hex');

    ALTER TABLE appointment ALTER COLUMN manage_token_hash SET NOT NULL;

    -- sha256 as lowercase hex is always 64 characters. Constraining the shape
    -- stops the application from storing a raw token here by mistake, which is
    -- the one failure that would undo the whole point of the column.
    ALTER TABLE appointment
      ADD CONSTRAINT appointment_manage_token_hash_shape
        CHECK (manage_token_hash ~ '^[0-9a-f]{64}$');

    -- Unique, so a lookup by token is an index probe and a collision is
    -- impossible rather than merely improbable. Not tenant-scoped: the token is
    -- the credential, and a token valid in two tenants at once would be a bug
    -- worth failing on.
    CREATE UNIQUE INDEX appointment_manage_token_hash_key
      ON appointment (manage_token_hash);

    -- Booking writes it; cancel and reschedule read it in a WHERE clause.
    GRANT INSERT (manage_token_hash) ON appointment TO whiteboard_public;
    GRANT SELECT (manage_token_hash) ON appointment TO whiteboard_public;

    -- See the note above. Needed to re-run availability for the new time.
    GRANT SELECT (service_id) ON appointment TO whiteboard_public;

    -- Cancel writes status. Reschedule writes the rest.
    --
    -- status is grantable as a whole column or not at all, so this does permit
    -- writing COMPLETED or NO_SHOW as well as CANCELLED. That adds no reach:
    -- all three free the slot identically, so anyone who can write one can
    -- already achieve the only effect that matters. The CHECK keeps the set
    -- closed, and the application only ever parameterizes the literal
    -- 'CANCELLED'. Narrowing it further needs a WITH CHECK on the public
    -- role's RLS policy, which is the right fix and is noted in
    -- database-roles.md as a known gap.
    GRANT UPDATE (
      status, staff_id, resource_id,
      starts_at, ends_at, blocked_starts_at, blocked_ends_at
    ) ON appointment TO whiteboard_public;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE UPDATE (
      status, staff_id, resource_id,
      starts_at, ends_at, blocked_starts_at, blocked_ends_at
    ) ON appointment FROM whiteboard_public;

    REVOKE SELECT (service_id) ON appointment FROM whiteboard_public;
    REVOKE SELECT (manage_token_hash) ON appointment FROM whiteboard_public;
    REVOKE INSERT (manage_token_hash) ON appointment FROM whiteboard_public;

    DROP INDEX appointment_manage_token_hash_key;

    ALTER TABLE appointment
      DROP CONSTRAINT appointment_manage_token_hash_shape;

    ALTER TABLE appointment DROP COLUMN manage_token_hash;
  `);
};
