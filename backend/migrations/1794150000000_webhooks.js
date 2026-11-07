// Webhooks: an owner registers a URL, and every appointment change is POSTed
// to it, signed. Deliveries are jobs in the outbox, queued by the appointment
// trigger in the same transaction as the change.
//
// Owner-only, because a webhook sends customer details to a URL outside the
// app: app_caller_owns() is app_caller_manages() without managers. The secret
// is kept in plain text because signing needs it; the app reads it only
// through webhook_target(), which the worker calls at send time.

const TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;

// The previous trigger, for down.
const TRIGGER_V2 = `
      DECLARE
        actor text := NULLIF(current_setting('app.user_id', true), '');
        notice text;
        moved boolean := false;
        recipient record;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          INSERT INTO appointment_event (tenant_id, appointment_id, kind, actor_user_id, staff_id, starts_at, ends_at, status)
          VALUES (NEW.tenant_id, NEW.id, 'booked', actor, NEW.staff_id, NEW.starts_at, NEW.ends_at, NEW.status);
          notice := 'booked';
        ELSE
          IF (NEW.starts_at, NEW.ends_at, NEW.staff_id) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at, OLD.staff_id) THEN
            INSERT INTO appointment_event (tenant_id, appointment_id, kind, actor_user_id,
                                           staff_id, starts_at, ends_at, previous_staff_id, previous_starts_at, previous_ends_at)
            VALUES (NEW.tenant_id, NEW.id, 'moved', actor,
                    NEW.staff_id, NEW.starts_at, NEW.ends_at, OLD.staff_id, OLD.starts_at, OLD.ends_at);
            moved := true;
            notice := 'moved';
          END IF;
          IF NEW.status IS DISTINCT FROM OLD.status THEN
            INSERT INTO appointment_event (tenant_id, appointment_id, kind, actor_user_id, status, previous_status)
            VALUES (NEW.tenant_id, NEW.id, 'status', actor, NEW.status, OLD.status);
            IF NEW.status = 'CANCELLED' THEN notice := 'cancelled'; END IF;
          END IF;
          IF moved OR NEW.status IS DISTINCT FROM OLD.status THEN
            UPDATE job SET finished_at = now(), outcome = 'cancelled', payload = '{}'
            WHERE kind = 'reminder' AND finished_at IS NULL AND dedupe_key LIKE 'reminder:' || NEW.id || ':%';
          END IF;
        END IF;

        -- Tell the staff member, unless they did it themselves or it's past.
        IF notice IS NOT NULL AND NEW.starts_at > now() THEN
          SELECT u.id AS user_id, u.email, t.name AS org, t.slug, t.timezone, s.name AS service, c.name AS customer
            INTO recipient
            FROM staff st
            JOIN "user" u ON u.id = st.user_id
            JOIN tenant t ON t.id = NEW.tenant_id
            JOIN service s ON s.id = NEW.service_id
            JOIN customer c ON c.id = NEW.customer_id
           WHERE st.id = NEW.staff_id AND st.archived_at IS NULL;
          IF FOUND AND recipient.user_id IS DISTINCT FROM actor THEN
            INSERT INTO job (kind, payload, expires_at)
            VALUES ('staff_notice', jsonb_build_object(
                      'to', recipient.email, 'notice', notice, 'organization', recipient.org, 'slug', recipient.slug,
                      'timeZone', recipient.timezone, 'service', recipient.service, 'customer', recipient.customer,
                      'startsAt', NEW.starts_at,
                      'previousStartsAt', CASE WHEN moved THEN OLD.starts_at END),
                    LEAST(NEW.starts_at, now() + interval '2 days'));
          END IF;
        END IF;
        RETURN NEW;
      END`;

const TRIGGER_V3 = `
      DECLARE
        actor text := NULLIF(current_setting('app.user_id', true), '');
        notice text;
        moved boolean := false;
        recipient record;
        event_id uuid;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          INSERT INTO appointment_event (tenant_id, appointment_id, kind, actor_user_id, staff_id, starts_at, ends_at, status)
          VALUES (NEW.tenant_id, NEW.id, 'booked', actor, NEW.staff_id, NEW.starts_at, NEW.ends_at, NEW.status)
          RETURNING id INTO event_id;
          PERFORM queue_appointment_webhooks(NEW, NULL, event_id, 'appointment.booked');
          notice := 'booked';
        ELSE
          IF (NEW.starts_at, NEW.ends_at, NEW.staff_id) IS DISTINCT FROM (OLD.starts_at, OLD.ends_at, OLD.staff_id) THEN
            INSERT INTO appointment_event (tenant_id, appointment_id, kind, actor_user_id,
                                           staff_id, starts_at, ends_at, previous_staff_id, previous_starts_at, previous_ends_at)
            VALUES (NEW.tenant_id, NEW.id, 'moved', actor,
                    NEW.staff_id, NEW.starts_at, NEW.ends_at, OLD.staff_id, OLD.starts_at, OLD.ends_at)
            RETURNING id INTO event_id;
            PERFORM queue_appointment_webhooks(NEW, OLD, event_id, 'appointment.moved');
            moved := true;
            notice := 'moved';
          END IF;
          IF NEW.status IS DISTINCT FROM OLD.status THEN
            INSERT INTO appointment_event (tenant_id, appointment_id, kind, actor_user_id, status, previous_status)
            VALUES (NEW.tenant_id, NEW.id, 'status', actor, NEW.status, OLD.status)
            RETURNING id INTO event_id;
            PERFORM queue_appointment_webhooks(NEW, OLD, event_id,
              CASE NEW.status WHEN 'CANCELLED' THEN 'appointment.cancelled' ELSE 'appointment.status_changed' END);
            IF NEW.status = 'CANCELLED' THEN notice := 'cancelled'; END IF;
          END IF;
          IF moved OR NEW.status IS DISTINCT FROM OLD.status THEN
            UPDATE job SET finished_at = now(), outcome = 'cancelled', payload = '{}'
            WHERE kind = 'reminder' AND finished_at IS NULL AND dedupe_key LIKE 'reminder:' || NEW.id || ':%';
          END IF;
        END IF;

        IF notice IS NOT NULL AND NEW.starts_at > now() THEN
          SELECT u.id AS user_id, u.email, t.name AS org, t.slug, t.timezone, s.name AS service, c.name AS customer
            INTO recipient
            FROM staff st
            JOIN "user" u ON u.id = st.user_id
            JOIN tenant t ON t.id = NEW.tenant_id
            JOIN service s ON s.id = NEW.service_id
            JOIN customer c ON c.id = NEW.customer_id
           WHERE st.id = NEW.staff_id AND st.archived_at IS NULL;
          IF FOUND AND recipient.user_id IS DISTINCT FROM actor THEN
            INSERT INTO job (kind, payload, expires_at)
            VALUES ('staff_notice', jsonb_build_object(
                      'to', recipient.email, 'notice', notice, 'organization', recipient.org, 'slug', recipient.slug,
                      'timeZone', recipient.timezone, 'service', recipient.service, 'customer', recipient.customer,
                      'startsAt', NEW.starts_at,
                      'previousStartsAt', CASE WHEN moved THEN OLD.starts_at END),
                    LEAST(NEW.starts_at, now() + interval '2 days'));
          END IF;
        END IF;
        RETURN NEW;
      END`;

const fn = (body) => `
    CREATE OR REPLACE FUNCTION record_appointment_event() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$${body}
    $$;`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION app_caller_owns() RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT EXISTS (
          SELECT 1 FROM tenant
          JOIN member ON member."organizationId" = tenant.better_auth_org_id
          WHERE tenant.id = ${TENANT}
            AND member."userId" = NULLIF(current_setting('app.user_id', true), '')
            AND member.role = 'owner'
        )
      $$;

    CREATE TABLE webhook_endpoint (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   uuid NOT NULL REFERENCES tenant(id),
      url         text NOT NULL CHECK (length(url) <= 2000),
      secret      text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX webhook_endpoint_tenant_idx ON webhook_endpoint (tenant_id);
    ALTER TABLE webhook_endpoint ENABLE ROW LEVEL SECURITY;
    CREATE POLICY webhook_endpoint_owner ON webhook_endpoint TO whiteboard_app
      USING (tenant_id = ${TENANT} AND (SELECT app_caller_owns()))
      WITH CHECK (tenant_id = ${TENANT} AND (SELECT app_caller_owns()));
    GRANT SELECT (id, tenant_id, url, created_at), INSERT, DELETE ON webhook_endpoint TO whiteboard_app;

    -- Which endpoint a delivery is for, and what it carries, outside the payload
    -- so a delivery's history survives the payload being cleared.
    ALTER TABLE job ADD COLUMN ref uuid, ADD COLUMN label text;
    CREATE INDEX job_ref_idx ON job (ref, created_at) WHERE ref IS NOT NULL;
    ALTER TABLE job DROP CONSTRAINT job_kind_check;
    ALTER TABLE job ADD CONSTRAINT job_kind_check
      CHECK (kind IN ('mail', 'staff_notice', 'reminder', 'time_off_notice', 'webhook'));

    CREATE FUNCTION queue_appointment_webhooks(a appointment, before appointment, event_id uuid, event_type text)
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        body jsonb;
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM webhook_endpoint WHERE tenant_id = a.tenant_id) THEN RETURN; END IF;
        SELECT jsonb_build_object(
                 'id', event_id, 'type', event_type, 'createdAt', now(),
                 'data', jsonb_build_object(
                   'appointmentId', a.id, 'status', a.status,
                   'startsAt', a.starts_at, 'endsAt', a.ends_at,
                   'previousStartsAt', before.starts_at, 'previousEndsAt', before.ends_at, 'previousStatus', before.status,
                   'service', jsonb_build_object('id', s.id, 'name', s.name),
                   'staff', CASE WHEN st.id IS NULL THEN NULL ELSE jsonb_build_object('id', st.id, 'name', st.name) END,
                   'customer', jsonb_build_object('name', c.name, 'email', c.email, 'phone', c.phone)))
          INTO body
          FROM service s
          JOIN customer c ON c.id = a.customer_id
          LEFT JOIN staff st ON st.id = a.staff_id
         WHERE s.id = a.service_id;
        INSERT INTO job (kind, payload, expires_at, ref, label)
        SELECT 'webhook', body, now() + interval '3 days', e.id, event_type
          FROM webhook_endpoint e WHERE e.tenant_id = a.tenant_id;
      END
    $$;
    REVOKE ALL ON FUNCTION queue_appointment_webhooks(appointment, appointment, uuid, text) FROM PUBLIC;

    -- Where and how to sign, read by the worker at send time. A removed
    -- endpoint returns nothing, and its deliveries stop.
    CREATE FUNCTION webhook_target(endpoint uuid) RETURNS TABLE (url text, secret text)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT url, secret FROM webhook_endpoint WHERE id = endpoint
      $$;
    REVOKE ALL ON FUNCTION webhook_target(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION webhook_target(uuid) TO whiteboard_app;

    ${fn(TRIGGER_V3)}
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ${fn(TRIGGER_V2)}
    DROP FUNCTION webhook_target(uuid);
    DROP FUNCTION queue_appointment_webhooks(appointment, appointment, uuid, text);
    DELETE FROM job WHERE kind = 'webhook';
    ALTER TABLE job DROP CONSTRAINT job_kind_check;
    ALTER TABLE job ADD CONSTRAINT job_kind_check CHECK (kind IN ('mail', 'staff_notice', 'reminder', 'time_off_notice'));
    DROP INDEX job_ref_idx;
    ALTER TABLE job DROP COLUMN ref, DROP COLUMN label;
    DROP TABLE webhook_endpoint;
    DROP FUNCTION app_caller_owns();
  `);
};
