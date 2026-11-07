// Tell a staff member when their time-off request is approved or declined,
// queued by the database in the same transaction as the decision.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE job DROP CONSTRAINT job_kind_check;
    ALTER TABLE job ADD CONSTRAINT job_kind_check
      CHECK (kind IN ('mail', 'staff_notice', 'reminder', 'time_off_notice'));

    CREATE FUNCTION notify_time_off_decided() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        recipient record;
      BEGIN
        SELECT u.email, t.name AS org, t.slug, t.timezone
          INTO recipient
          FROM staff st
          JOIN "user" u ON u.id = st.user_id
          JOIN tenant t ON t.id = NEW.tenant_id
         WHERE st.id = NEW.staff_id AND st.archived_at IS NULL;
        IF FOUND THEN
          INSERT INTO job (kind, payload, expires_at)
          VALUES ('time_off_notice', jsonb_build_object(
                    'to', recipient.email, 'decision', NEW.status, 'organization', recipient.org,
                    'slug', recipient.slug, 'timeZone', recipient.timezone,
                    'startsAt', NEW.starts_at, 'endsAt', NEW.ends_at),
                  GREATEST(NEW.starts_at, now() + interval '1 day'));
        END IF;
        RETURN NEW;
      END
    $$;
    REVOKE ALL ON FUNCTION notify_time_off_decided() FROM PUBLIC;

    CREATE TRIGGER time_off_decided
      AFTER UPDATE OF status ON time_off
      FOR EACH ROW
      WHEN (OLD.status = 'pending' AND NEW.status IN ('approved', 'declined'))
      EXECUTE FUNCTION notify_time_off_decided();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER time_off_decided ON time_off;
    DROP FUNCTION notify_time_off_decided();
    DELETE FROM job WHERE kind = 'time_off_notice';
    ALTER TABLE job DROP CONSTRAINT job_kind_check;
    ALTER TABLE job ADD CONSTRAINT job_kind_check CHECK (kind IN ('mail', 'staff_notice', 'reminder'));
  `);
};
