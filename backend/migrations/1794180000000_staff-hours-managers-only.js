// Only owners and managers set working hours. Staff used to change their own,
// which let someone whose time off was declined clear their hours for those
// days instead. Everyone in the tenant still reads them.

const TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;
const MANAGES = '(SELECT app_caller_manages())';
const OWN_STAFF = '(SELECT app_caller_staff_id())';

const policies = (who) => `
  DROP POLICY staff_working_hours_app_insert ON staff_working_hours;
  DROP POLICY staff_working_hours_app_delete ON staff_working_hours;
  CREATE POLICY staff_working_hours_app_insert ON staff_working_hours
    FOR INSERT TO whiteboard_app
    WITH CHECK (tenant_id = ${TENANT} AND ${who});
  CREATE POLICY staff_working_hours_app_delete ON staff_working_hours
    FOR DELETE TO whiteboard_app
    USING (tenant_id = ${TENANT} AND ${who});
`;

exports.up = (pgm) => pgm.sql(policies(MANAGES));
exports.down = (pgm) => pgm.sql(policies(`(${MANAGES} OR staff_id = ${OWN_STAFF})`));
