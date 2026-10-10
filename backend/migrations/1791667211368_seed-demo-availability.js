// The demo tenants have staff, services and a resource, but no hours — so the
// availability endpoint returns every day closed for both of them. This fills
// the gap, and deliberately seeds enough awkwardness that the "why was this
// time not offered" output has something to say.
//
// The two demo tenants are a lucky pair for a DST demonstration:
//
//   Marina's Cuts & Color   America/New_York   45-minute Cut, no resource
//   Studio Wien             Europe/Vienna      150-minute Full Color, needs the wash station
//
// They change their clocks on different dates — Vienna on 25 October 2026, New
// York on 1 November — so asking both for the same week in late October returns
// slots whose local times match on both sides and whose underlying moments do
// not. That is the phase gate, visible in two curl commands.
//
// Seeded as a migration to match seed-demo-tenants rather than because seed
// data belongs in migrations. Migrations run as the table owner, who bypasses
// RLS, which is why these inserts need no app.tenant_id.

const MARINA_TENANT = '11111111-1111-1111-1111-111111111111';
const WIEN_TENANT = '22222222-2222-2222-2222-222222222222';
const MARINA_STAFF = 'a1111111-1111-1111-1111-111111111111';
const ANNA_STAFF = 'a2222222-2222-2222-2222-222222222222';
const CUT_SERVICE = 'b1111111-1111-1111-1111-111111111111';
const COLOR_SERVICE = 'b2222222-2222-2222-2222-222222222222';
const WASH_STATION = 'c2222222-2222-2222-2222-222222222222';
const DEMO_CUSTOMER = 'd1111111-1111-1111-1111-111111111111';
const DEMO_APPOINTMENT = 'e1111111-1111-1111-1111-111111111111';

exports.up = (pgm) => {
  pgm.sql(`
    -- Business hours. ISO weekdays, 1 = Monday.
    --
    -- Marina opens Tuesday to Saturday, 09:00-18:00, with a split shift on
    -- Saturday so the engine's lunch-gap behaviour is visible without having to
    -- construct it. Studio Wien runs Monday to Friday 10:00-20:00, late enough
    -- that a 150-minute colour cannot start after 17:30.
    INSERT INTO business_hours (tenant_id, weekday, opens_at, closes_at) VALUES
      ('${MARINA_TENANT}', 2, '09:00', '18:00'),
      ('${MARINA_TENANT}', 3, '09:00', '18:00'),
      ('${MARINA_TENANT}', 4, '09:00', '18:00'),
      ('${MARINA_TENANT}', 5, '09:00', '18:00'),
      ('${MARINA_TENANT}', 6, '09:00', '13:00'),
      ('${MARINA_TENANT}', 6, '14:00', '17:00'),
      ('${WIEN_TENANT}', 1, '10:00', '20:00'),
      ('${WIEN_TENANT}', 2, '10:00', '20:00'),
      ('${WIEN_TENANT}', 3, '10:00', '20:00'),
      ('${WIEN_TENANT}', 4, '10:00', '20:00'),
      ('${WIEN_TENANT}', 5, '10:00', '20:00');

    -- Staff working hours, narrower than the business in places, so that
    -- "the salon is open but nobody is working" is a state you can actually see.
    -- Marina works the full day except Thursdays, when she starts at 12:00.
    -- Anna finishes at 18:00 while the studio stays open until 20:00.
    INSERT INTO staff_working_hours (staff_id, tenant_id, weekday, start_time, end_time) VALUES
      ('${MARINA_STAFF}', '${MARINA_TENANT}', 2, '09:00', '18:00'),
      ('${MARINA_STAFF}', '${MARINA_TENANT}', 3, '09:00', '18:00'),
      ('${MARINA_STAFF}', '${MARINA_TENANT}', 4, '12:00', '18:00'),
      ('${MARINA_STAFF}', '${MARINA_TENANT}', 5, '09:00', '18:00'),
      ('${MARINA_STAFF}', '${MARINA_TENANT}', 6, '09:00', '13:00'),
      ('${MARINA_STAFF}', '${MARINA_TENANT}', 6, '14:00', '17:00'),
      ('${ANNA_STAFF}', '${WIEN_TENANT}', 1, '10:00', '18:00'),
      ('${ANNA_STAFF}', '${WIEN_TENANT}', 2, '10:00', '18:00'),
      ('${ANNA_STAFF}', '${WIEN_TENANT}', 3, '10:00', '18:00'),
      ('${ANNA_STAFF}', '${WIEN_TENANT}', 4, '10:00', '18:00'),
      ('${ANNA_STAFF}', '${WIEN_TENANT}', 5, '10:00', '18:00');

    -- Anna is off on the Vienna clock-change weekend, stored as instants in her
    -- local midnight-to-midnight. Friday 23 October is CEST (+02:00), so local
    -- midnight is 22:00Z the evening before; Monday 26 October is CET (+01:00),
    -- so its midnight is 23:00Z. Writing both offsets out by hand is the point:
    -- a single fixed offset would be wrong at one end.
    INSERT INTO time_off (staff_id, tenant_id, starts_at, ends_at, reason) VALUES
      ('${ANNA_STAFF}', '${WIEN_TENANT}',
       '2026-10-22T22:00:00Z', '2026-10-25T23:00:00Z', 'Away for the long weekend');

    -- One booked appointment for Marina, so the reasons output has a 'busy' to
    -- report rather than only 'outsideWorkingHours'. Tuesday 27 October 2026 at
    -- 10:00 New York time, which is EDT (-04:00) — the US has not changed its
    -- clocks yet that week, which is exactly the trap this project exists to
    -- demonstrate. 45-minute Cut, no buffers, so the stored range is 14:00-14:45Z.
    INSERT INTO customer (id, tenant_id, name, email) VALUES
      ('${DEMO_CUSTOMER}', '${MARINA_TENANT}', 'Demo Customer', 'demo@example.com');

    INSERT INTO appointment (id, tenant_id, staff_id, service_id, customer_id, starts_at, ends_at, status)
    VALUES ('${DEMO_APPOINTMENT}', '${MARINA_TENANT}', '${MARINA_STAFF}', '${CUT_SERVICE}',
            '${DEMO_CUSTOMER}', '2026-10-27T14:00:00Z', '2026-10-27T14:45:00Z', 'BOOKED');

    -- Buffers on the colour service, so the wash station is held either side of
    -- the appointment and the buffer rules are exercised by the demo rather
    -- than only by the tests.
    UPDATE service SET buffer_before_minutes = 10, buffer_after_minutes = 15
    WHERE id = '${COLOR_SERVICE}';

    -- Belt and braces: the service_resource backfill keyed off requires_resource,
    -- so this is a no-op on a database where that ran. It matters on one seeded
    -- fresh, where the ordering could leave the colour service with no station.
    INSERT INTO service_resource (service_id, resource_id, tenant_id)
    VALUES ('${COLOR_SERVICE}', '${WASH_STATION}', '${WIEN_TENANT}')
    ON CONFLICT (service_id, resource_id) DO NOTHING;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM service_resource
      WHERE service_id = '${COLOR_SERVICE}' AND resource_id = '${WASH_STATION}';

    UPDATE service SET buffer_before_minutes = 0, buffer_after_minutes = 0
      WHERE id = '${COLOR_SERVICE}';

    DELETE FROM appointment WHERE id = '${DEMO_APPOINTMENT}';
    DELETE FROM customer WHERE id = '${DEMO_CUSTOMER}';
    DELETE FROM time_off WHERE staff_id = '${ANNA_STAFF}';
    DELETE FROM staff_working_hours WHERE staff_id IN ('${MARINA_STAFF}', '${ANNA_STAFF}');
    DELETE FROM business_hours WHERE tenant_id IN ('${MARINA_TENANT}', '${WIEN_TENANT}');
  `);
};
