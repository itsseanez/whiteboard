exports.up = (pgm) => {
  pgm.sql(`
    ALTER POLICY tenant_select ON tenant TO whiteboard_public, whiteboard_signup;

    CREATE POLICY tenant_select_app ON tenant
        FOR SELECT
        TO whiteboard_app
        USING (
            id = current_setting('app.tenant_id', true)::uuid
            OR EXISTS (
                SELECT 1 FROM member
                WHERE member."organizationId" = tenant.better_auth_org_id
                    AND member."userId" = current_setting('app.user_id', true)
            )
        );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY IF EXISTS tenant_select_app ON tenant;
    ALTER POLICY tenant_select ON tenant TO PUBLIC;
  `);
};