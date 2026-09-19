// Keeps updated_at current on every UPDATE.
// A column DEFAULT only fires on INSERT; without this trigger,
// updated_at stays equal to created_at forever.
//
// now() is the transaction's start time, matching the column defaults,
// so every row changed in one transaction gets the same updated_at.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION set_updated_at() RETURNS trigger
      LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER business_hours_set_updated_at
      BEFORE UPDATE ON business_hours
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TRIGGER staff_working_hours_set_updated_at
      BEFORE UPDATE ON staff_working_hours
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();

    CREATE TRIGGER time_off_set_updated_at
      BEFORE UPDATE ON time_off
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER time_off_set_updated_at ON time_off;
    DROP TRIGGER staff_working_hours_set_updated_at ON staff_working_hours;
    DROP TRIGGER business_hours_set_updated_at ON business_hours;
    DROP FUNCTION set_updated_at();
  `);
};
