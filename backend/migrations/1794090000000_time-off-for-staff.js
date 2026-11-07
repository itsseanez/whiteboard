// Time off can now be added and removed from the app: by owners and managers
// for anyone, by staff for themselves. No UPDATE; a change is remove and add.
//
// Reading narrows too. The reason column is private ("chemotherapy", "job
// interview"), so staff read only their own rows; the tenant-wide read stays
// for owners and managers, whose calendar shows it. The public role keeps its
// tenant-only policy and its three columns, which availability needs.

const TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;
const MANAGES = '(SELECT app_caller_manages())';
const OWN_STAFF = '(SELECT app_caller_staff_id())';
const MINE = `tenant_id = ${TENANT} AND (${MANAGES} OR staff_id = ${OWN_STAFF})`;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER POLICY time_off_isolation ON time_off TO whiteboard_public;
    CREATE POLICY time_off_app_read ON time_off FOR SELECT TO whiteboard_app USING (${MINE});
    CREATE POLICY time_off_app_insert ON time_off FOR INSERT TO whiteboard_app WITH CHECK (${MINE});
    CREATE POLICY time_off_app_delete ON time_off FOR DELETE TO whiteboard_app USING (${MINE});
    GRANT INSERT (staff_id, tenant_id, starts_at, ends_at, reason), DELETE ON time_off TO whiteboard_app;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE INSERT, DELETE ON time_off FROM whiteboard_app;
    DROP POLICY time_off_app_delete ON time_off;
    DROP POLICY time_off_app_insert ON time_off;
    DROP POLICY time_off_app_read ON time_off;
    ALTER POLICY time_off_isolation ON time_off TO public;
  `);
};
