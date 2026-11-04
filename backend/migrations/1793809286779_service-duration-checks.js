// A service with no duration, or a negative buffer, would reach the engine as a
// zero-length or inverted interval. Owners can now write these rows, so the
// database refuses them instead of trusting every form.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE service
      ADD CONSTRAINT service_duration_positive CHECK (duration_minutes > 0),
      ADD CONSTRAINT service_buffers_non_negative CHECK (buffer_before_minutes >= 0 AND buffer_after_minutes >= 0);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE service
      DROP CONSTRAINT service_buffers_non_negative,
      DROP CONSTRAINT service_duration_positive;
  `);
};
