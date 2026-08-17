exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
    CREATE POLICY staff_isolation ON staff
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

    ALTER TABLE service ENABLE ROW LEVEL SECURITY;
    CREATE POLICY service_isolation ON service
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

    ALTER TABLE resource ENABLE ROW LEVEL SECURITY;
    CREATE POLICY resource_isolation ON resource
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

    ALTER TABLE customer ENABLE ROW LEVEL SECURITY;
    CREATE POLICY customer_isolation ON customer
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

    ALTER TABLE appointment ENABLE ROW LEVEL SECURITY;
    CREATE POLICY appointment_isolation ON appointment
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY appointment_isolation ON appointment;
    ALTER TABLE appointment DISABLE ROW LEVEL SECURITY;

    DROP POLICY customer_isolation ON customer;
    ALTER TABLE customer DISABLE ROW LEVEL SECURITY;

    DROP POLICY resource_isolation ON resource;
    ALTER TABLE resource DISABLE ROW LEVEL SECURITY;

    DROP POLICY service_isolation ON service;
    ALTER TABLE service DISABLE ROW LEVEL SECURITY;

    DROP POLICY staff_isolation ON staff;
    ALTER TABLE staff DISABLE ROW LEVEL SECURITY;
  `);
};