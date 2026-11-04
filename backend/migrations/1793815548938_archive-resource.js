// Resources are archived like staff and services: appointments reference them.
// The public role reads id and archived_at so a booking can re-check that the
// resource it took wasn't archived while it was being written.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE resource ADD COLUMN archived_at timestamptz;
    GRANT SELECT (id, archived_at) ON resource TO whiteboard_public;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE SELECT (id, archived_at) ON resource FROM whiteboard_public;
    ALTER TABLE resource DROP COLUMN archived_at;
  `);
};
