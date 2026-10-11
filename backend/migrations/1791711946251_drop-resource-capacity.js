// resource.capacity was never read. It appeared exactly once in the repository
// — its own column definition — and the engine's ResourceCandidate carries only
// an id and its busy intervals.
//
// It is dropped rather than wired up, because capacity > 1 cannot be expressed
// as an exclusion constraint. EXCLUDE says "no two rows conflict"; there is no
// operator for "at most N rows conflict". Honouring the column would mean a
// counting trigger holding a lock across a count-then-insert, which puts back
// exactly the race the exclusion constraint exists to remove.
//
// The model that works is the one service_resource already assumes: one row per
// physical unit. Three wash stations are three resource rows, and three rows
// permit three concurrent bookings under the same constraint, with no new
// machinery and the invariant still in the database.
//
// Left in place, the column is worse than nothing: it looks like a setting, so
// the owner UI eventually renders it, and then it is a feature that silently
// does not work.

exports.up = (pgm) => {
  pgm.sql(`ALTER TABLE resource DROP COLUMN capacity;`);
};

exports.down = (pgm) => {
  // Restores the original definition exactly, so a round trip leaves the table
  // as the initial schema declared it.
  pgm.sql(`ALTER TABLE resource ADD COLUMN capacity integer NOT NULL DEFAULT 1;`);
};
