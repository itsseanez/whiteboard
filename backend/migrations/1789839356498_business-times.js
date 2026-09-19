exports.up = (pgm) => {
  pgm.sql(`
    -- business hours for a tenant
    -- ISO: 1 = Monday, 7 = Sunday
    CREATE TABLE business_hours (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   uuid NOT NULL REFERENCES tenant(id),
      weekday     smallint NOT NULL CHECK (weekday >= 1 AND weekday <= 7),
      opens_at    time NOT NULL,
      closes_at   time NOT NULL CHECK (closes_at > opens_at OR (closes_at = '00:00' AND opens_at <> '00:00')),
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX business_hours_tenant_id_idx ON business_hours(tenant_id);

    ALTER TABLE staff ADD CONSTRAINT staff_id_tenant_id_key UNIQUE (id, tenant_id);

    -- staff working hours for a tenant
    CREATE TABLE staff_working_hours (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id    uuid NOT NULL,
      tenant_id   uuid NOT NULL,
      weekday     smallint NOT NULL CHECK (weekday >= 1 AND weekday <= 7),
      start_time  time NOT NULL,
      end_time    time NOT NULL CHECK (end_time > start_time OR (end_time = '00:00' AND start_time <> '00:00')),
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (staff_id, tenant_id) REFERENCES staff(id, tenant_id) ON DELETE CASCADE
    );
    CREATE INDEX staff_working_hours_staff_id_idx ON staff_working_hours(staff_id);
    CREATE INDEX staff_working_hours_tenant_id_idx ON staff_working_hours(tenant_id);

    -- time off for staff, e.g. vacation or sick leave
    CREATE TABLE time_off (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      staff_id    uuid NOT NULL,
      tenant_id   uuid NOT NULL,
      starts_at   timestamptz NOT NULL,
      ends_at     timestamptz NOT NULL CHECK (ends_at > starts_at),
      reason      text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (staff_id, tenant_id) REFERENCES staff(id, tenant_id) ON DELETE CASCADE
    );
    CREATE INDEX time_off_staff_id_idx ON time_off(staff_id);
    CREATE INDEX time_off_tenant_id_idx ON time_off(tenant_id);

    -- RLS policies for business hours, staff working hours, and time off
    ALTER TABLE business_hours ENABLE ROW LEVEL SECURITY;
    CREATE POLICY business_hours_isolation ON business_hours
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

    ALTER TABLE staff_working_hours ENABLE ROW LEVEL SECURITY;
    CREATE POLICY staff_working_hours_isolation ON staff_working_hours
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

    ALTER TABLE time_off ENABLE ROW LEVEL SECURITY;
    CREATE POLICY time_off_isolation ON time_off
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE time_off;
    DROP TABLE staff_working_hours;
    ALTER TABLE staff DROP CONSTRAINT staff_id_tenant_id_key;
    DROP TABLE business_hours;
  `);
};
