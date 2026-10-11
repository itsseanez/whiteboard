// The invariant that makes concurrent booking safe: no staff member and no
// resource can hold two overlapping appointments.
//
// WHY THIS IS IN THE DATABASE AND NOT IN THE SERVICE LAYER
//
// Checking availability and then inserting is two statements. Under READ
// COMMITTED every statement takes a fresh snapshot, so two requests can both
// read "14:00 is free", both pass the check, and both insert. The window is
// milliseconds wide and it is the single most likely bug in a booking app:
// impossible to reproduce by hand, trivial to hit with two customers on a
// phone. SELECT ... FOR UPDATE does not help either, because there is no row
// to lock — the conflict is with a row that does not exist yet.
//
// An exclusion constraint is the only thing that closes it. Postgres takes a
// lock on the index entry as the row is inserted, so the second transaction
// blocks until the first commits and is then rejected with SQLSTATE 23P01.
// Exactly one wins, with no application coordination at all.
//
// WHICH INTERVAL IS CONSTRAINED
//
// The blocked interval, [start − before-buffer, end + after-buffer), not the
// service times. Two appointments may touch but not overlap, so constraining
// the buffered range is what makes the additive-buffer rule enforce itself:
// a 10-minute after-buffer and a 5-minute before-buffer leave 15 minutes
// between two appointments because their blocked ranges may not overlap.
//
// The bounds are stored rather than computed from the service's current
// buffers, deliberately. An owner who edits a service's buffers next month
// must not silently change what every existing appointment occupies — or worse,
// make two already-booked appointments conflict. The buffers are snapshotted at
// booking time.
//
// AGREEMENT WITH THE ENGINE
//
// Both are predicated on status = 'BOOKED', and both treat ranges as half-open.
// DECISIONS.md names this as the accepted cost of computing availability in
// TypeScript: interval semantics now exist in two places and must match
// exactly. A test should assert that the engine refuses precisely what the
// database refuses.

exports.up = (pgm) => {
  pgm.sql(`
    -- Nullable first so existing rows can be backfilled.
    ALTER TABLE appointment
      ADD COLUMN blocked_starts_at timestamptz,
      ADD COLUMN blocked_ends_at   timestamptz;

    -- Existing rows get the buffers their service carries today. That is the
    -- best available answer: those appointments were booked before buffers were
    -- recorded per appointment, so there is nothing more faithful to recover.
    UPDATE appointment a
    SET blocked_starts_at = a.starts_at - make_interval(mins => s.buffer_before_minutes),
        blocked_ends_at   = a.ends_at   + make_interval(mins => s.buffer_after_minutes)
    FROM service s
    WHERE s.id = a.service_id;

    ALTER TABLE appointment
      ALTER COLUMN blocked_starts_at SET NOT NULL,
      ALTER COLUMN blocked_ends_at   SET NOT NULL;

    -- Generated and stored, so the range cannot drift from its bounds and the
    -- application never has to construct range literals. Verified that
    -- tstzrange() is immutable enough for a generated column.
    ALTER TABLE appointment
      ADD COLUMN blocked tstzrange
        GENERATED ALWAYS AS (tstzrange(blocked_starts_at, blocked_ends_at, '[)')) STORED;

    -- The canonical casing is UPPER. The initial schema defaulted the column to
    -- lowercase 'booked' while every query and this CHECK use 'BOOKED', so the
    -- default and the constraint disagreed: any insert that did not name status
    -- explicitly took a value the CHECK rejects. Worse, while there was no
    -- CHECK, such a row would have been stored and then been invisible to the
    -- availability engine, whose query filters status = 'BOOKED' — a booked
    -- appointment silently not blocking its own slot.
    UPDATE appointment SET status = upper(status) WHERE status <> upper(status);

    ALTER TABLE appointment ALTER COLUMN status SET DEFAULT 'BOOKED';

    -- Guard on existing rows, so an unexpected value names itself rather than
    -- failing as an opaque constraint violation.
    DO $$
    DECLARE bad text;
    BEGIN
      SELECT string_agg(DISTINCT status, ', ') INTO bad
      FROM appointment
      WHERE status NOT IN ('BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');
      IF bad IS NOT NULL THEN
        RAISE EXCEPTION
          'Cannot migrate: appointment.status holds unexpected value(s): %. Add them to the CHECK or correct the rows.', bad;
      END IF;
    END $$;

    -- And guard the DEFAULT, which is the check that was missing. Rows are not
    -- the only thing a CHECK has to agree with: a default the constraint
    -- rejects makes every insert that omits the column fail, and the migration
    -- itself succeeds while doing it.
    DO $$
    DECLARE d text;
    BEGIN
      SELECT column_default INTO d
      FROM information_schema.columns
      WHERE table_name = 'appointment' AND column_name = 'status';
      IF d IS DISTINCT FROM '''BOOKED''::text' THEN
        RAISE EXCEPTION
          'Cannot migrate: appointment.status default is %, which the status CHECK below would reject.', coalesce(d, 'NULL');
      END IF;
    END $$;

    -- Only BOOKED blocks the slot, which is what the partial exclusion
    -- constraints below encode. CANCELLED, COMPLETED and NO_SHOW all free it:
    -- the first because the customer withdrew, the other two because the
    -- appointment is in the past and nothing can be booked over it anyway.
    -- NO_SHOW exists to be reported on, not to hold time.
    ALTER TABLE appointment
      ADD CONSTRAINT appointment_status_check
        CHECK (status IN ('BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW')),

      -- A zero-length or reversed appointment is not a thing.
      --
      -- This guards the SERVICE times only. A reversed BLOCKED pair never
      -- reaches a CHECK: the generated column is computed first and
      -- tstzrange() itself raises "range lower bound must be less than or
      -- equal to range upper bound". Correct, but it names no constraint, so
      -- do not be surprised by it.
      ADD CONSTRAINT appointment_ends_after_starts
        CHECK (ends_at > starts_at),

      -- The blocked interval must contain the service interval. Equality is
      -- allowed, which is the no-buffer case.
      ADD CONSTRAINT appointment_blocked_contains_service
        CHECK (blocked_starts_at <= starts_at AND blocked_ends_at >= ends_at);

    -- The two invariants. Partial on status so a cancelled appointment frees
    -- its slot, and on NOT NULL so the index holds only rows that can conflict:
    -- staff_id is null for a resource-only booking and resource_id is null for
    -- a service that needs no resource, and NULL = NULL never matches anyway.
    --
    -- btree_gist (created in the initial schema) is what lets a uuid use the =
    -- operator inside a gist index alongside the range's &&.
    ALTER TABLE appointment
      ADD CONSTRAINT appointment_staff_no_overlap
        EXCLUDE USING gist (staff_id WITH =, blocked WITH &&)
        WHERE (status = 'BOOKED' AND staff_id IS NOT NULL),

      ADD CONSTRAINT appointment_resource_no_overlap
        EXCLUDE USING gist (resource_id WITH =, blocked WITH &&)
        WHERE (status = 'BOOKED' AND resource_id IS NOT NULL);

    -- The engine's own query is a window scan per tenant, which neither gist
    -- index serves well.
    CREATE INDEX appointment_tenant_starts_at_idx
      ON appointment (tenant_id, starts_at)
      WHERE status = 'BOOKED';
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP INDEX appointment_tenant_starts_at_idx;

    ALTER TABLE appointment
      DROP CONSTRAINT appointment_resource_no_overlap,
      DROP CONSTRAINT appointment_staff_no_overlap,
      DROP CONSTRAINT appointment_blocked_contains_service,
      DROP CONSTRAINT appointment_ends_after_starts,
      DROP CONSTRAINT appointment_status_check;

    -- All three columns the up added. Dropping only some leaves the next up
    -- failing on "column already exists".
    ALTER TABLE appointment
      DROP COLUMN blocked,
      DROP COLUMN blocked_ends_at,
      DROP COLUMN blocked_starts_at;

    -- Faithfully restores what the initial schema declared, bug included. A
    -- down migration that quietly improves things is a down migration you
    -- cannot trust to reproduce the previous state.
    ALTER TABLE appointment ALTER COLUMN status SET DEFAULT 'booked';
  `);
};
