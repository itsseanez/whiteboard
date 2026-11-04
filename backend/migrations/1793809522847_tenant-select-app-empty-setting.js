// A transaction-local set_config leaves the setting as '' (not unset) on that
// pooled connection once the transaction ends. The next request on the same
// connection that sets only app.user_id then fails casting '' to uuid, and
// tenant_select_app errors instead of falling through to its membership branch.
// NULLIF turns the leftover '' into NULL, which matches no tenant.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER POLICY tenant_select_app ON tenant
      USING (
        id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
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
    ALTER POLICY tenant_select_app ON tenant
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
