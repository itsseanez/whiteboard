// Erasing a customer left their name in the inbox: each appointment
// notification holds a copy of it. Notifications now record which customer
// they're about, and a trigger on customer keeps that copy in step with the
// name, so an erase renames them to "Erased customer" in the same transaction.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE notification ADD COLUMN customer_id uuid REFERENCES customer(id) ON DELETE SET NULL;
    CREATE INDEX notification_customer_idx ON notification (customer_id) WHERE customer_id IS NOT NULL;

    -- Existing rows: the event that wrote each one had this customer, name and start.
    UPDATE notification n SET customer_id = c.id
      FROM appointment_event e
      JOIN appointment a ON a.id = e.appointment_id
      JOIN customer c ON c.id = a.customer_id
     WHERE n.customer_id IS NULL
       AND n.category = 'appointments'
       AND n.tenant_id = e.tenant_id
       AND n.data->>'customer' = c.name
       AND (n.data->>'startsAt')::timestamptz = e.starts_at;

    CREATE OR REPLACE FUNCTION notify_appointment_event() RETURNS trigger
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

        SELECT a.starts_at, a.staff_id, t.name AS org, t.slug, t.timezone, s.name AS service, c.id AS customer_id, c.name AS customer,
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
          INSERT INTO notification (user_id, tenant_id, customer_id, kind, category, link, data)
          VALUES (stylist, NEW.tenant_id, info.customer_id, kind, 'appointments', '/manage/' || info.slug || '/me', payload);
        END IF;

        IF NEW.actor_user_id IS NULL THEN
          FOR manager IN SELECT tenant_managers(NEW.tenant_id) LOOP
            IF manager IS DISTINCT FROM stylist THEN
              INSERT INTO notification (user_id, tenant_id, customer_id, kind, category, link, data)
              VALUES (manager, NEW.tenant_id, info.customer_id, kind, 'appointments', '/manage/' || info.slug || '?tab=calendar', payload);
            END IF;
          END LOOP;
        END IF;
        RETURN NEW;
      END
    $$;

    CREATE FUNCTION notification_follow_customer() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      BEGIN
        UPDATE notification SET data = jsonb_set(data, '{customer}', to_jsonb(NEW.name))
         WHERE customer_id = NEW.id AND tenant_id = NEW.tenant_id;
        RETURN NEW;
      END
    $$;
    REVOKE ALL ON FUNCTION notification_follow_customer() FROM PUBLIC;
    CREATE TRIGGER customer_name_to_notifications AFTER UPDATE OF name ON customer
      FOR EACH ROW WHEN (OLD.name IS DISTINCT FROM NEW.name)
      EXECUTE FUNCTION notification_follow_customer();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER customer_name_to_notifications ON customer;
    DROP FUNCTION notification_follow_customer();

    CREATE OR REPLACE FUNCTION notify_appointment_event() RETURNS trigger
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

    DROP INDEX notification_customer_idx;
    ALTER TABLE notification DROP COLUMN customer_id;
  `);
};
