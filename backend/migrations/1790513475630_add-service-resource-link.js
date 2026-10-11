// A service needs one of several interchangeable resources — any free wash
// station will do. `requires_resource` said only that one was needed, and a
// single `service.resource_id` would say exactly which, so neither can express
// a pool. The join table does: a service links to every resource that can
// serve it, and "requires a resource" becomes "has at least one link row".
//
// Both FKs are composite so a link cannot cross tenants: without the tenant_id
// pair, a service in tenant A could link a resource in tenant B and RLS would
// not catch it, because the link row's own tenant_id is still correct.

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE service  ADD CONSTRAINT service_id_tenant_id_key  UNIQUE (id, tenant_id);
    ALTER TABLE resource ADD CONSTRAINT resource_id_tenant_id_key UNIQUE (id, tenant_id);

    -- which resources can serve a given service; any one of them will do
    CREATE TABLE service_resource (
      service_id   uuid NOT NULL,
      resource_id  uuid NOT NULL,
      tenant_id    uuid NOT NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (service_id, resource_id),
      FOREIGN KEY (service_id, tenant_id)  REFERENCES service(id, tenant_id),
      FOREIGN KEY (resource_id, tenant_id) REFERENCES resource(id, tenant_id)
    );
    CREATE INDEX service_resource_resource_id_idx ON service_resource(resource_id);
    CREATE INDEX service_resource_tenant_id_idx   ON service_resource(tenant_id);

    ALTER TABLE service_resource ENABLE ROW LEVEL SECURITY;
    CREATE POLICY service_resource_isolation ON service_resource
      USING (tenant_id = current_setting('app.tenant_id')::uuid)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::uuid);

    -- Backfill: a service that required a resource is linked to every resource
    -- its tenant owns, which is the pooled reading of the old boolean.
    INSERT INTO service_resource (service_id, resource_id, tenant_id)
    SELECT s.id, r.id, s.tenant_id
    FROM service s
    JOIN resource r ON r.tenant_id = s.tenant_id
    WHERE s.requires_resource = true;

    -- A tenant with no resources leaves such a service with zero links, which
    -- would silently turn a service that needs equipment into one that does not.
    DO $$
    DECLARE orphaned integer;
    BEGIN
      SELECT count(*) INTO orphaned
      FROM service s
      WHERE s.requires_resource = true
        AND NOT EXISTS (SELECT 1 FROM service_resource sr WHERE sr.service_id = s.id);
      IF orphaned > 0 THEN
        RAISE EXCEPTION
          'Cannot migrate: % service row(s) require a resource but their tenant owns none. Create the resources first.',
          orphaned;
      END IF;
    END $$;

    ALTER TABLE service DROP COLUMN requires_resource;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    -- Rebuilt from the link rows. Which resources were linked is not
    -- recoverable; that detail is lost on rollback.
    ALTER TABLE service ADD COLUMN requires_resource boolean NOT NULL DEFAULT false;
    UPDATE service s SET requires_resource = true
    WHERE EXISTS (SELECT 1 FROM service_resource sr WHERE sr.service_id = s.id);

    DROP TABLE service_resource;

    ALTER TABLE resource DROP CONSTRAINT resource_id_tenant_id_key;
    ALTER TABLE service  DROP CONSTRAINT service_id_tenant_id_key;
  `);
};
