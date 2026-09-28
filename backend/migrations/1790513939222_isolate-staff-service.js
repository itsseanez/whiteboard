// staff_service was created with only (staff_id, service_id): no tenant_id, no
// RLS, and two single-column FKs that each check one side in isolation. Nothing
// stopped a row pairing a staff member in one tenant with a service in another,
// and with RLS never enabled on the table, whiteboard_app could read and write
// every tenant's rows regardless of app.tenant_id.
//
// This matters beyond storage: staff_service is what answers "which staff can
// perform this service", so a cross-tenant row would put a staff member into
// another tenant's availability results.
//
// MUST RUN AFTER the migration that adds service_resource — that one creates
// the UNIQUE (id, tenant_id) constraint on service which the composite FK below
// references. staff already has its own from the working-hours migration.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE staff_service ADD COLUMN tenant_id uuid;

    -- Any existing row whose two sides disagree cannot be assigned a single
    -- tenant_id. The composite FK would reject it below; failing here says why.
    DO $$
    DECLARE mismatched integer;
    BEGIN
      SELECT count(*) INTO mismatched
      FROM staff_service ss
      JOIN staff st   ON st.id = ss.staff_id
      JOIN service sv ON sv.id = ss.service_id
      WHERE st.tenant_id <> sv.tenant_id;
      IF mismatched > 0 THEN
        RAISE EXCEPTION
          'Cannot migrate: % staff_service row(s) link a staff member and a service from different tenants. Resolve them before migrating.',
          mismatched;
      END IF;
    END $$;

    UPDATE staff_service ss SET tenant_id = st.tenant_id
    FROM staff st WHERE st.id = ss.staff_id;

    ALTER TABLE staff_service ALTER COLUMN tenant_id SET NOT NULL;
    ALTER TABLE staff_service ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

    -- Composite FKs check each side together with the tenant, so a link can no
    -- longer cross tenants. These names are Postgres defaults for the original
    -- single-column references; confirm with \\d staff_service before running.
    ALTER TABLE staff_service DROP CONSTRAINT staff_service_staff_id_fkey;
    ALTER TABLE staff_service DROP CONSTRAINT staff_service_service_id_fkey;

    ALTER TABLE staff_service ADD CONSTRAINT staff_service_staff_fkey
      FOREIGN KEY (staff_id, tenant_id) REFERENCES staff(id, tenant_id);
    ALTER TABLE staff_service ADD CONSTRAINT staff_service_service_fkey
      FOREIGN KEY (service_id, tenant_id) REFERENCES service(id, tenant_id);

    -- The primary key is (staff_id, service_id), so a lookup by service alone —
    -- "which staff can perform this service", the engine's own query — has no
    -- index to use.
    CREATE INDEX staff_service_service_id_idx ON staff_service(service_id);
    CREATE INDEX staff_service_tenant_id_idx  ON staff_service(tenant_id);

    ALTER TABLE staff_service ENABLE ROW LEVEL SECURITY;
    CREATE POLICY staff_service_isolation ON staff_service
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP POLICY staff_service_isolation ON staff_service;
    ALTER TABLE staff_service DISABLE ROW LEVEL SECURITY;

    DROP INDEX staff_service_tenant_id_idx;
    DROP INDEX staff_service_service_id_idx;

    ALTER TABLE staff_service DROP CONSTRAINT staff_service_service_fkey;
    ALTER TABLE staff_service DROP CONSTRAINT staff_service_staff_fkey;

    ALTER TABLE staff_service ADD CONSTRAINT staff_service_staff_id_fkey
      FOREIGN KEY (staff_id) REFERENCES staff(id);
    ALTER TABLE staff_service ADD CONSTRAINT staff_service_service_id_fkey
      FOREIGN KEY (service_id) REFERENCES service(id);

    ALTER TABLE staff_service DROP COLUMN tenant_id;
  `);
};
