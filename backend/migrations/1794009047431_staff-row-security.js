// Staff see only their own appointments and those appointments' customers;
// owners and managers see the whole tenant. Both are worked out from
// app.user_id inside the database, so a caller with no user set sees nothing.
// The public role keeps the tenant-only policies: the booking page needs every
// appointment to compute availability, and never returns customer details.

const TENANT = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`;
const MANAGES = '(SELECT app_caller_manages())';
const OWN_STAFF = '(SELECT app_caller_staff_id())';

exports.up = (pgm) => {
  pgm.sql(`
    -- Is the caller an owner or manager of the tenant in app.tenant_id?
    CREATE FUNCTION app_caller_manages() RETURNS boolean
      LANGUAGE sql STABLE AS $$
        SELECT EXISTS (
          SELECT 1 FROM tenant
          JOIN member ON member."organizationId" = tenant.better_auth_org_id
          WHERE tenant.id = ${TENANT}
            AND member."userId" = NULLIF(current_setting('app.user_id', true), '')
            AND member.role IN ('owner', 'admin')
        )
      $$;

    -- The caller's own staff row in that tenant, unless it's archived.
    CREATE FUNCTION app_caller_staff_id() RETURNS uuid
      LANGUAGE sql STABLE AS $$
        SELECT id FROM staff
        WHERE tenant_id = ${TENANT}
          AND user_id = NULLIF(current_setting('app.user_id', true), '')
          AND archived_at IS NULL
      $$;

    ALTER POLICY appointment_isolation ON appointment TO whiteboard_public;
    CREATE POLICY appointment_app ON appointment TO whiteboard_app
      USING (tenant_id = ${TENANT} AND (${MANAGES} OR staff_id = ${OWN_STAFF}))
      WITH CHECK (tenant_id = ${TENANT} AND ${MANAGES});

    ALTER POLICY customer_isolation ON customer TO whiteboard_public;
    CREATE POLICY customer_app ON customer TO whiteboard_app
      USING (
        tenant_id = ${TENANT}
        AND (
          ${MANAGES}
          OR EXISTS (
            SELECT 1 FROM appointment
            WHERE appointment.customer_id = customer.id
              AND appointment.staff_id = ${OWN_STAFF}
          )
        )
      )
      WITH CHECK (tenant_id = ${TENANT} AND ${MANAGES});

    -- Anyone in the tenant reads hours; staff change only their own.
    ALTER POLICY staff_working_hours_isolation ON staff_working_hours TO whiteboard_public;
    CREATE POLICY staff_working_hours_app_read ON staff_working_hours
      FOR SELECT TO whiteboard_app
      USING (tenant_id = ${TENANT});
    CREATE POLICY staff_working_hours_app_insert ON staff_working_hours
      FOR INSERT TO whiteboard_app
      WITH CHECK (tenant_id = ${TENANT} AND (${MANAGES} OR staff_id = ${OWN_STAFF}));
    CREATE POLICY staff_working_hours_app_delete ON staff_working_hours
      FOR DELETE TO whiteboard_app
      USING (tenant_id = ${TENANT} AND (${MANAGES} OR staff_id = ${OWN_STAFF}));
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY staff_working_hours_app_delete ON staff_working_hours;
    DROP POLICY staff_working_hours_app_insert ON staff_working_hours;
    DROP POLICY staff_working_hours_app_read ON staff_working_hours;
    ALTER POLICY staff_working_hours_isolation ON staff_working_hours TO public;
    DROP POLICY customer_app ON customer;
    ALTER POLICY customer_isolation ON customer TO public;
    DROP POLICY appointment_app ON appointment;
    ALTER POLICY appointment_isolation ON appointment TO public;
    DROP FUNCTION app_caller_staff_id();
    DROP FUNCTION app_caller_manages();
  `);
};
