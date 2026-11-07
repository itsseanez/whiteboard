// Staff ask for time off; owners and managers approve or decline it. Only
// approved time off blocks availability, so asking can't freeze a calendar.
//
// Existing rows were all entered by owners and managers, so they're approved.
// New rows default to pending: a forgotten status asks rather than blocks.
//
// RLS carries the rules. Staff may insert only their own rows, and only as
// pending; they may remove their own only while not approved; only owners and
// managers update status. The public role gets the status column, because
// availability reads only approved rows.

const TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;
const MANAGES = '(SELECT app_caller_manages())';
const OWN_STAFF = '(SELECT app_caller_staff_id())';

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE time_off
      ADD COLUMN status text NOT NULL DEFAULT 'approved'
        CHECK (status IN ('pending', 'approved', 'declined'));
    ALTER TABLE time_off ALTER COLUMN status SET DEFAULT 'pending';

    ALTER POLICY time_off_app_insert ON time_off
      WITH CHECK (tenant_id = ${TENANT} AND (${MANAGES} OR (staff_id = ${OWN_STAFF} AND status = 'pending')));
    ALTER POLICY time_off_app_delete ON time_off
      USING (tenant_id = ${TENANT} AND (${MANAGES} OR (staff_id = ${OWN_STAFF} AND status <> 'approved')));
    CREATE POLICY time_off_app_decide ON time_off FOR UPDATE TO whiteboard_app
      USING (tenant_id = ${TENANT} AND ${MANAGES})
      WITH CHECK (tenant_id = ${TENANT} AND ${MANAGES});

    GRANT INSERT (status), UPDATE (status) ON time_off TO whiteboard_app;
    GRANT SELECT (status) ON time_off TO whiteboard_public;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE SELECT (status) ON time_off FROM whiteboard_public;
    REVOKE INSERT (status), UPDATE (status) ON time_off FROM whiteboard_app;
    DROP POLICY time_off_app_decide ON time_off;
    ALTER POLICY time_off_app_delete ON time_off
      USING (tenant_id = ${TENANT} AND (${MANAGES} OR staff_id = ${OWN_STAFF}));
    ALTER POLICY time_off_app_insert ON time_off
      WITH CHECK (tenant_id = ${TENANT} AND (${MANAGES} OR staff_id = ${OWN_STAFF}));
    ALTER TABLE time_off DROP COLUMN status;
  `);
};
