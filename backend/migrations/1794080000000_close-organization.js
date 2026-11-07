// An owner can close their organization: it's archived, not deleted, so the
// slug stays taken and the records stay. Only an owner can set archived_at,
// and only on their own tenant. The old tenant_update and tenant_delete
// policies applied to every role; they now name only whiteboard_signup, which
// has no UPDATE or DELETE grant, so they no longer let the app role through.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE tenant ADD COLUMN archived_at timestamptz;
    GRANT SELECT (archived_at) ON tenant TO whiteboard_public;
    GRANT UPDATE (archived_at) ON tenant TO whiteboard_app;

    ALTER POLICY tenant_update ON tenant TO whiteboard_signup;
    ALTER POLICY tenant_delete ON tenant TO whiteboard_signup;

    -- Inline rather than a function that reads tenant, so the policy never
    -- queries the table it guards.
    CREATE POLICY tenant_close_app ON tenant FOR UPDATE TO whiteboard_app
      USING (
        id = NULLIF(current_setting('app.tenant_id', true), '')::uuid
        AND EXISTS (
          SELECT 1 FROM member
          WHERE member."organizationId" = tenant.better_auth_org_id
            AND member."userId" = NULLIF(current_setting('app.user_id', true), '')
            AND member.role = 'owner'
        )
      )
      WITH CHECK (id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY tenant_close_app ON tenant;
    ALTER POLICY tenant_delete ON tenant TO public;
    ALTER POLICY tenant_update ON tenant TO public;
    REVOKE UPDATE (archived_at) ON tenant FROM whiteboard_app;
    REVOKE SELECT (archived_at) ON tenant FROM whiteboard_public;
    ALTER TABLE tenant DROP COLUMN archived_at;
  `);
};
