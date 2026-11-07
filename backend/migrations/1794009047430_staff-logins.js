// A staff row can belong to one sign-in, which is how a staff member reaches
// their own week. The link is made when they accept an invitation, which
// carries the staff row it was sent for. whiteboard_app reads invitations to
// decide what an accept should do, the same way provisioning decides from state.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff ADD COLUMN user_id text REFERENCES "user"(id) ON DELETE SET NULL;
    CREATE UNIQUE INDEX staff_tenant_user_key ON staff (tenant_id, user_id) WHERE user_id IS NOT NULL;
    ALTER TABLE invitation ADD COLUMN "staffId" text;
    GRANT SELECT ON invitation TO whiteboard_app;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE SELECT ON invitation FROM whiteboard_app;
    ALTER TABLE invitation DROP COLUMN "staffId";
    DROP INDEX staff_tenant_user_key;
    ALTER TABLE staff DROP COLUMN user_id;
  `);
};
