// Every change to an appointment, written by the database itself.
//
// A trigger on appointment records each booking, move and status change in
// appointment_event, so no route, role or future code path can change an
// appointment without leaving a line. Who did it comes from app.user_id: a
// signed-in owner, manager or staff member, or nobody, which means the
// customer (the public booking page and the manage link set no user).
//
// The history is append-only for the app: no application role may insert,
// update or delete a row; only the trigger writes, as SECURITY DEFINER.
// Owners and managers read it, scoped to their tenant by RLS.

const TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE appointment_event (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id          uuid NOT NULL,
      appointment_id     uuid NOT NULL REFERENCES appointment(id) ON DELETE CASCADE,
      kind               text NOT NULL CHECK (kind IN ('booked', 'moved', 'status')),
      at                 timestamptz NOT NULL DEFAULT now(),
      actor_user_id      text,
      staff_id           uuid,
      starts_at          timestamptz,
      ends_at            timestamptz,
      status             text,
      previous_staff_id  uuid,
      previous_starts_at timestamptz,
      previous_ends_at   timestamptz,
      previous_status    text,
      -- Booked before history was kept, so who booked it isn't known.
      before_history     boolean NOT NULL DEFAULT false
    );
    CREATE INDEX appointment_event_appointment_idx ON appointment_event (appointment_id, at);

    CREATE FUNCTION record_appointment_event() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        actor text := NULLIF(current_setting('app.user_id', true), '');
      BEGIN
        IF TG_OP = 'INSERT' THEN
          INSERT INTO appointment_event (tenant_id, appointment_id, kind, actor_user_id, staff_id, starts_at, ends_at, status)
          VALUES (NEW.tenant_id, NEW.id, 'booked', actor, NEW.staff_id, NEW.starts_at, NEW.ends_at, NEW.status);
          RETURN NEW;
        END IF;
        IF (NEW.starts_at, NEW.ends_at, NEW.staff_id) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at, OLD.staff_id) THEN
          INSERT INTO appointment_event (tenant_id, appointment_id, kind, actor_user_id,
                                         staff_id, starts_at, ends_at, previous_staff_id, previous_starts_at, previous_ends_at)
          VALUES (NEW.tenant_id, NEW.id, 'moved', actor,
                  NEW.staff_id, NEW.starts_at, NEW.ends_at, OLD.staff_id, OLD.starts_at, OLD.ends_at);
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status THEN
          INSERT INTO appointment_event (tenant_id, appointment_id, kind, actor_user_id, status, previous_status)
          VALUES (NEW.tenant_id, NEW.id, 'status', actor, NEW.status, OLD.status);
        END IF;
        RETURN NEW;
      END
    $$;
    REVOKE ALL ON FUNCTION record_appointment_event() FROM PUBLIC;

    CREATE TRIGGER appointment_history
      AFTER INSERT OR UPDATE ON appointment
      FOR EACH ROW EXECUTE FUNCTION record_appointment_event();

    -- What already exists gets its booking line, marked as from before.
    INSERT INTO appointment_event (tenant_id, appointment_id, kind, at, staff_id, starts_at, ends_at, status, before_history)
    SELECT tenant_id, id, 'booked', created_at, staff_id, starts_at, ends_at, status, true FROM appointment;

    ALTER TABLE appointment_event ENABLE ROW LEVEL SECURITY;
    CREATE POLICY appointment_event_read ON appointment_event FOR SELECT TO whiteboard_app
      USING (tenant_id = ${TENANT} AND (SELECT app_caller_manages()));
    GRANT SELECT ON appointment_event TO whiteboard_app;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER appointment_history ON appointment;
    DROP FUNCTION record_appointment_event();
    DROP TABLE appointment_event;
  `);
};
