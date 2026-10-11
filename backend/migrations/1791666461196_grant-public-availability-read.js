// Column-scoped SELECT for whiteboard_public, covering exactly what the public
// availability endpoint queries — no more.
//
// WHY COLUMN-SCOPED AND NOT `GRANT SELECT ON <table>`
//
// RLS already stops whiteboard_public reading another tenant's rows. Column
// privileges stop it reading columns it has no business seeing within its OWN
// tenant's rows. Those are different leaks, and the second one is the kind a
// booking page causes by accident: the engine needs to know THAT a stylist is
// busy from 14:00 to 15:00, and has no need to know who booked it, what they
// booked, or why someone is off work.
//
// So three columns are withheld on purpose, and each would be a real disclosure:
//
//   time_off.reason        — "chemotherapy", "job interview". Health and private
//                            life, attached to a named employee.
//   appointment.customer_id — lets anyone enumerate who visits the salon and when.
//   appointment.service_id  — lets anyone infer what each customer is having done.
//
// Postgres checks column privileges against every column the QUERY references,
// including ones that appear only in WHERE or ORDER BY — so appointment.status
// has to be granted even though it is never returned. Columns referenced only
// inside an RLS policy do not need granting: the policy is part of the table
// definition and is not evaluated with the caller's column privileges. That is
// why tenant_id appears nowhere below even though every policy tests it.
//
// If a query later selects a column that is not listed here, Postgres raises
// 42501 (insufficient_privilege) rather than returning NULLs — it fails closed,
// which is what makes this list safe to keep tight.

exports.up = (pgm) => {
  pgm.sql(`
    -- The requested service's own policy fields. The name column is included
    -- because a booking page that cannot name the service is not a booking page.
    GRANT SELECT (
      id, name, duration_minutes, buffer_before_minutes,
      buffer_after_minutes, minimum_notice_minutes
    ) ON service TO whiteboard_public;

    -- Which stylists can perform the service. service_id is referenced in the
    -- WHERE clause, so it needs granting too.
    GRANT SELECT (staff_id, service_id) ON staff_service TO whiteboard_public;

    -- Which resources the service occupies. The resource table itself is NOT
    -- granted: a customer never chooses a wash station, so the public response
    -- carries no resource ids and the engine only needs to know the ids exist.
    GRANT SELECT (service_id, resource_id) ON service_resource TO whiteboard_public;

    -- Opening hours. Weekly patterns, a handful of rows per tenant.
    GRANT SELECT (weekday, opens_at, closes_at) ON business_hours TO whiteboard_public;

    GRANT SELECT (staff_id, weekday, start_time, end_time)
      ON staff_working_hours TO whiteboard_public;

    -- reason is withheld. A customer may learn that nobody is available; never why.
    GRANT SELECT (staff_id, starts_at, ends_at) ON time_off TO whiteboard_public;

    -- customer_id and service_id are withheld. status is granted because the
    -- query filters on it.
    GRANT SELECT (id, staff_id, resource_id, starts_at, ends_at, status)
      ON appointment TO whiteboard_public;

    -- Stylist names, for rendering the slot list. No other staff column.
    GRANT SELECT (id, name) ON staff TO whiteboard_public;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE SELECT (id, name) ON staff FROM whiteboard_public;
    REVOKE SELECT (id, staff_id, resource_id, starts_at, ends_at, status)
      ON appointment FROM whiteboard_public;
    REVOKE SELECT (staff_id, starts_at, ends_at) ON time_off FROM whiteboard_public;
    REVOKE SELECT (staff_id, weekday, start_time, end_time)
      ON staff_working_hours FROM whiteboard_public;
    REVOKE SELECT (weekday, opens_at, closes_at) ON business_hours FROM whiteboard_public;
    REVOKE SELECT (service_id, resource_id) ON service_resource FROM whiteboard_public;
    REVOKE SELECT (staff_id, service_id) ON staff_service FROM whiteboard_public;
    REVOKE SELECT (
      id, name, duration_minutes, buffer_before_minutes,
      buffer_after_minutes, minimum_notice_minutes
    ) ON service FROM whiteboard_public;
  `);
};
