exports.up = (pgm) => {
  pgm.sql(`
    -- How far ahead a booking must be made, per service: a colour needs more
    -- warning than a fringe trim. 0 means bookable right up to the start; the
    -- engine still refuses times already past.
    ALTER TABLE service ADD COLUMN minimum_notice_minutes integer NOT NULL DEFAULT 5
      CHECK (minimum_notice_minutes >= 0);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE service DROP COLUMN minimum_notice_minutes;
  `);
};
