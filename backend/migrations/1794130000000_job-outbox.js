// An outbox for work done after the request: emails now, webhooks later.
//
// The app inserts a row instead of sending; an in-process worker claims due
// rows with FOR UPDATE SKIP LOCKED and a lease, so two processes (an old and a
// new container overlapping during a deploy) never take the same job. Failures
// retry with backoff until the job's expires_at, after which it's dropped: a
// reset link is worthless after an hour, a reminder after the appointment.
// Payloads are cleared when a job finishes, because they hold email bodies.
//
// The appointment trigger now also enqueues a notice to the staff member when
// someone else books, moves or cancels their appointment, in the same
// transaction as the change, and withdraws a pending reminder when an
// appointment moves or is cancelled. enqueue_due_reminders() finds what's due
// tomorrow across tenants; the dedupe key makes running it often harmless.

const TRIGGER_V1 = `
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
      END`;

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

const fn = (body) => `
    CREATE OR REPLACE FUNCTION record_appointment_event() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$${body}
    $$;`;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE job (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind          text NOT NULL CHECK (kind IN ('mail', 'staff_notice', 'reminder')),
      payload       jsonb NOT NULL,
      dedupe_key    text UNIQUE,
      run_at        timestamptz NOT NULL DEFAULT now(),
      expires_at    timestamptz NOT NULL,
      attempts      integer NOT NULL DEFAULT 0,
      locked_until  timestamptz,
      last_error    text,
      finished_at   timestamptz,
      outcome       text CHECK (outcome IN ('sent', 'expired', 'cancelled', 'failed')),
      created_at    timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX job_due_idx ON job (run_at) WHERE finished_at IS NULL;
    GRANT SELECT, INSERT, UPDATE, DELETE ON job TO whiteboard_app;

    ${fn(TRIGGER_V2)}

    CREATE FUNCTION enqueue_due_reminders() RETURNS integer
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        queued integer;
      BEGIN
        -- Tomorrow's appointments, if they were booked at least a day ahead:
        -- someone who booked this morning for this afternoon needs no reminder.
        INSERT INTO job (kind, payload, dedupe_key, expires_at)
        SELECT 'reminder',
               jsonb_build_object('to', c.email, 'customer', c.name, 'organization', t.name, 'slug', t.slug,
                                  'timeZone', t.timezone, 'service', s.name, 'staff', st.name, 'startsAt', a.starts_at),
               'reminder:' || a.id || ':' || floor(extract(epoch FROM a.starts_at))::bigint,
               a.starts_at
          FROM appointment a
          JOIN tenant t ON t.id = a.tenant_id AND t.archived_at IS NULL
          JOIN customer c ON c.id = a.customer_id
          JOIN service s ON s.id = a.service_id
          LEFT JOIN staff st ON st.id = a.staff_id
         WHERE a.status = 'BOOKED'
           AND a.starts_at > now() + interval '1 hour'
           AND a.starts_at <= now() + interval '24 hours'
           AND a.created_at <= a.starts_at - interval '24 hours'
           AND c.email IS NOT NULL AND c.email <> ''
        ON CONFLICT (dedupe_key) DO NOTHING;
        GET DIAGNOSTICS queued = ROW_COUNT;
        RETURN queued;
      END
    $$;
    REVOKE ALL ON FUNCTION enqueue_due_reminders() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION enqueue_due_reminders() TO whiteboard_app;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION enqueue_due_reminders();
    ${fn(TRIGGER_V1)}
    DROP TABLE job;
  `);
};
