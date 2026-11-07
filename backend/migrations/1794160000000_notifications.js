// The inbox: notifications for signed-in people, written by the database in
// the same transaction as what they're about.
//
//   · a stylist hears when someone else books, moves or cancels one of their
//     appointments, and when their time off is decided;
//   · owners and managers hear when a customer books, moves or cancels (their
//     own changes aren't news), when someone asks for time off, and when
//     someone joins.
//
// Rows hold data, not sentences: the page words them, in the organization's
// zone. Each person reads and marks only their own, enforced by RLS on
// app.user_id; no application role can insert or delete one.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE notification (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
      tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
      kind        text NOT NULL CHECK (kind IN (
                    'appointment_booked', 'appointment_moved', 'appointment_cancelled',
                    'time_off_requested', 'time_off_approved', 'time_off_declined', 'member_joined')),
      category    text NOT NULL CHECK (category IN ('appointments', 'time_off', 'team')),
      link        text NOT NULL,
      data        jsonb NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      read_at     timestamptz
    );
    CREATE INDEX notification_user_idx ON notification (user_id, created_at DESC);
    CREATE INDEX notification_unread_idx ON notification (user_id) WHERE read_at IS NULL;

    ALTER TABLE notification ENABLE ROW LEVEL SECURITY;
    CREATE POLICY notification_own ON notification TO whiteboard_app
      USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
      WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));
    GRANT SELECT, UPDATE (read_at) ON notification TO whiteboard_app;

    -- Owners and managers of a tenant, as Better Auth user ids.
    CREATE FUNCTION tenant_managers(tenant uuid) RETURNS SETOF text
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT m."userId" FROM member m JOIN tenant t ON t.better_auth_org_id = m."organizationId"
        WHERE t.id = tenant AND m.role IN ('owner', 'admin')
      $$;
    REVOKE ALL ON FUNCTION tenant_managers(uuid) FROM PUBLIC;

    CREATE FUNCTION notify_appointment_event() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        kind text;
        info record;
        payload jsonb;
        stylist text;
        manager text;
      BEGIN
        kind := CASE
          WHEN NEW.kind = 'booked' THEN 'appointment_booked'
          WHEN NEW.kind = 'moved' THEN 'appointment_moved'
          WHEN NEW.kind = 'status' AND NEW.status = 'CANCELLED' THEN 'appointment_cancelled'
        END;
        IF kind IS NULL OR NEW.before_history THEN RETURN NEW; END IF;

        SELECT a.starts_at, a.staff_id, t.name AS org, t.slug, t.timezone, s.name AS service, c.name AS customer,
               st.name AS staff_name, CASE WHEN st.archived_at IS NULL THEN st.user_id END AS staff_user
          INTO info
          FROM appointment a
          JOIN tenant t ON t.id = a.tenant_id
          JOIN service s ON s.id = a.service_id
          JOIN customer c ON c.id = a.customer_id
          LEFT JOIN staff st ON st.id = a.staff_id
         WHERE a.id = NEW.appointment_id;
        IF NOT FOUND OR info.starts_at <= now() THEN RETURN NEW; END IF;

        payload := jsonb_build_object(
          'organization', info.org, 'timeZone', info.timezone, 'service', info.service,
          'customer', info.customer, 'staff', info.staff_name, 'startsAt', info.starts_at,
          'previousStartsAt', NEW.previous_starts_at,
          'byCustomer', NEW.actor_user_id IS NULL);

        stylist := info.staff_user;
        IF stylist IS NOT NULL AND stylist IS DISTINCT FROM NEW.actor_user_id THEN
          INSERT INTO notification (user_id, tenant_id, kind, category, link, data)
          VALUES (stylist, NEW.tenant_id, kind, 'appointments', '/manage/' || info.slug || '/me', payload);
        END IF;

        IF NEW.actor_user_id IS NULL THEN
          FOR manager IN SELECT tenant_managers(NEW.tenant_id) LOOP
            IF manager IS DISTINCT FROM stylist THEN
              INSERT INTO notification (user_id, tenant_id, kind, category, link, data)
              VALUES (manager, NEW.tenant_id, kind, 'appointments', '/manage/' || info.slug || '?tab=calendar', payload);
            END IF;
          END LOOP;
        END IF;
        RETURN NEW;
      END
    $$;
    REVOKE ALL ON FUNCTION notify_appointment_event() FROM PUBLIC;
    CREATE TRIGGER appointment_event_notify AFTER INSERT ON appointment_event
      FOR EACH ROW EXECUTE FUNCTION notify_appointment_event();

    CREATE FUNCTION notify_time_off() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        info record;
        payload jsonb;
        manager text;
      BEGIN
        SELECT t.name AS org, t.slug, t.timezone, st.name AS staff_name,
               CASE WHEN st.archived_at IS NULL THEN st.user_id END AS staff_user
          INTO info
          FROM staff st JOIN tenant t ON t.id = st.tenant_id
         WHERE st.id = NEW.staff_id;
        IF NOT FOUND THEN RETURN NEW; END IF;
        payload := jsonb_build_object('organization', info.org, 'timeZone', info.timezone, 'staff', info.staff_name,
                                      'startsAt', NEW.starts_at, 'endsAt', NEW.ends_at, 'reason', NEW.reason);

        IF TG_OP = 'INSERT' THEN
          -- A request: owners and managers decide it. The asker isn't told about their own.
          FOR manager IN SELECT tenant_managers(NEW.tenant_id) LOOP
            IF manager IS DISTINCT FROM info.staff_user THEN
              INSERT INTO notification (user_id, tenant_id, kind, category, link, data)
              VALUES (manager, NEW.tenant_id, 'time_off_requested', 'time_off', '/manage/' || info.slug || '?tab=time-off', payload);
            END IF;
          END LOOP;
        ELSIF info.staff_user IS NOT NULL THEN
          INSERT INTO notification (user_id, tenant_id, kind, category, link, data)
          VALUES (info.staff_user, NEW.tenant_id,
                  CASE NEW.status WHEN 'approved' THEN 'time_off_approved' ELSE 'time_off_declined' END,
                  'time_off', '/manage/' || info.slug || '/me', payload - 'reason');
        END IF;
        RETURN NEW;
      END
    $$;
    REVOKE ALL ON FUNCTION notify_time_off() FROM PUBLIC;
    CREATE TRIGGER time_off_requested_notify AFTER INSERT ON time_off
      FOR EACH ROW WHEN (NEW.status = 'pending') EXECUTE FUNCTION notify_time_off();
    CREATE TRIGGER time_off_decided_notify AFTER UPDATE OF status ON time_off
      FOR EACH ROW WHEN (OLD.status = 'pending' AND NEW.status IN ('approved', 'declined'))
      EXECUTE FUNCTION notify_time_off();

    CREATE FUNCTION notify_member_joined() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        info record;
        manager text;
      BEGIN
        SELECT t.id, t.name AS org, t.slug, u.name AS person
          INTO info
          FROM tenant t, "user" u
         WHERE t.better_auth_org_id = NEW."organizationId" AND u.id = NEW."userId";
        -- No tenant yet means this is sign-up creating the organization.
        IF NOT FOUND THEN RETURN NEW; END IF;
        FOR manager IN SELECT tenant_managers(info.id) LOOP
          IF manager IS DISTINCT FROM NEW."userId" THEN
            INSERT INTO notification (user_id, tenant_id, kind, category, link, data)
            VALUES (manager, info.id, 'member_joined', 'team', '/manage/' || info.slug || '?tab=accounts',
                    jsonb_build_object('organization', info.org, 'person', info.person, 'role', NEW.role));
          END IF;
        END LOOP;
        RETURN NEW;
      END
    $$;
    REVOKE ALL ON FUNCTION notify_member_joined() FROM PUBLIC;
    CREATE TRIGGER member_joined_notify AFTER INSERT ON member
      FOR EACH ROW EXECUTE FUNCTION notify_member_joined();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER member_joined_notify ON member;
    DROP FUNCTION notify_member_joined();
    DROP TRIGGER time_off_decided_notify ON time_off;
    DROP TRIGGER time_off_requested_notify ON time_off;
    DROP FUNCTION notify_time_off();
    DROP TRIGGER appointment_event_notify ON appointment_event;
    DROP FUNCTION notify_appointment_event();
    DROP FUNCTION tenant_managers(uuid);
    DROP TABLE notification;
  `);
};
