exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;

    CREATE POLICY tenant_select ON tenant
      FOR SELECT
      USING (true);

    CREATE POLICY tenant_insert ON tenant
      FOR INSERT
      TO whiteboard_signup
      WITH CHECK (true);

    CREATE POLICY tenant_update ON tenant
      FOR UPDATE
      USING (id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (id = current_setting('app.tenant_id')::uuid);

    CREATE POLICY tenant_delete ON tenant
      FOR DELETE
      USING (id = current_setting('app.tenant_id')::uuid);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY tenant_delete ON tenant;
    DROP POLICY tenant_update ON tenant;
    DROP POLICY tenant_insert ON tenant;
    DROP POLICY tenant_select ON tenant;
    ALTER TABLE tenant DISABLE ROW LEVEL SECURITY;
  `);
};