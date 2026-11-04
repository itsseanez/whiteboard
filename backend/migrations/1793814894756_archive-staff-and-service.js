// Owners can delete staff and services, but appointments reference both, and
// past ones are the organization's history. So a delete archives the row:
// hidden from setup, booking and the calendar, still there for the
// appointments that point at it. The public role reads archived_at to filter.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff   ADD COLUMN archived_at timestamptz;
    ALTER TABLE service ADD COLUMN archived_at timestamptz;
    GRANT SELECT (archived_at) ON staff   TO whiteboard_public;
    GRANT SELECT (archived_at) ON service TO whiteboard_public;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE SELECT (archived_at) ON service FROM whiteboard_public;
    REVOKE SELECT (archived_at) ON staff   FROM whiteboard_public;
    ALTER TABLE service DROP COLUMN archived_at;
    ALTER TABLE staff   DROP COLUMN archived_at;
  `);
};
