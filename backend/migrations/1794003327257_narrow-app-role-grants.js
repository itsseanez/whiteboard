// whiteboard_app had SELECT, INSERT, UPDATE, DELETE on every table in public,
// Better Auth's included (password hashes in account, live sessions), plus
// pgmigrations, and default privileges handing it every future table too.
// It now gets exactly what the code does with it, table by table. New tables
// get no access until a migration grants it.

const GRANTS = [
  ['tenant', 'SELECT'],
  // Read by provisioning and by tenant_select_app's membership branch.
  ['organization', 'SELECT'],
  ['member', 'SELECT'],
  // Owner setup: create and edit; a delete is an archive, which is an UPDATE.
  ['staff', 'SELECT, INSERT, UPDATE'],
  ['service', 'SELECT, INSERT, UPDATE'],
  ['resource', 'SELECT, INSERT, UPDATE'],
  // Replaced as a set: delete the old rows, insert the new.
  ['staff_service', 'SELECT, INSERT, DELETE'],
  ['service_resource', 'SELECT, INSERT, DELETE'],
  ['staff_working_hours', 'SELECT, INSERT, DELETE'],
  ['business_hours', 'SELECT, INSERT, DELETE'],
  ['time_off', 'SELECT'],
  // Owner bookings upsert the customer; cancel and reschedule are UPDATEs.
  ['customer', 'SELECT, INSERT, UPDATE'],
  ['appointment', 'SELECT, INSERT, UPDATE'],
];

exports.up = (pgm) => {
  pgm.sql(`
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM whiteboard_app;
    DO $$
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM whiteboard_app',
        current_user
      );
    END
    $$;
    ${GRANTS.map(([table, privileges]) => `GRANT ${privileges} ON ${table} TO whiteboard_app;`).join('\n    ')}
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO whiteboard_app;
    DO $$
    BEGIN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO whiteboard_app',
        current_user
      );
    END
    $$;
  `);
};
