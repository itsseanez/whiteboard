exports.up = (pgm) => {
  pgm.sql(`
    CREATE EXTENSION IF NOT EXISTS btree_gist;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    -- tenants are companies using the whiteboard system
    CREATE TABLE tenant (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name        text NOT NULL,
      slug        text NOT NULL UNIQUE,
      timezone    text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );

    -- staff are workers working for tenants
    CREATE TABLE staff (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   uuid NOT NULL REFERENCES tenant(id),
      name        text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX staff_tenant_id_idx ON staff(tenant_id);

    -- any service provided by tenants
    CREATE TABLE service (
      id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id          uuid NOT NULL REFERENCES tenant(id),
      name               text NOT NULL,
      duration_minutes   integer NOT NULL,
      buffer_before_minutes integer NOT NULL DEFAULT 0,
      buffer_after_minutes  integer NOT NULL DEFAULT 0,
      requires_resource  boolean NOT NULL DEFAULT false,
      created_at         timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX service_tenant_id_idx ON service(tenant_id);

    -- dictates which staff can provide which service
    CREATE TABLE staff_service (
      staff_id    uuid NOT NULL REFERENCES staff(id),
      service_id  uuid NOT NULL REFERENCES service(id),
      PRIMARY KEY (staff_id, service_id)
    );

    -- required resource for a serviceex: barber chairs
    CREATE TABLE resource (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   uuid NOT NULL REFERENCES tenant(id),
      name        text NOT NULL,
      capacity    integer NOT NULL DEFAULT 1,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX resource_tenant_id_idx ON resource(tenant_id);

    -- customer ordering a service
    CREATE TABLE customer (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id   uuid NOT NULL REFERENCES tenant(id),
      name        text NOT NULL,
      email       text NOT NULL,
      phone       text,
      created_at  timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX customer_tenant_id_idx ON customer(tenant_id);

    -- appointment for a service set by a customer
    CREATE TABLE appointment (
      id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id    uuid NOT NULL REFERENCES tenant(id),
      staff_id     uuid REFERENCES staff(id),
      service_id   uuid NOT NULL REFERENCES service(id),
      resource_id  uuid REFERENCES resource(id),
      customer_id  uuid NOT NULL REFERENCES customer(id),
      starts_at    timestamptz NOT NULL,
      ends_at      timestamptz NOT NULL,
      status       text NOT NULL DEFAULT 'booked',
      created_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX appointment_tenant_id_idx ON appointment(tenant_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TABLE appointment;
    DROP TABLE staff_service;
    DROP TABLE customer;
    DROP TABLE resource;
    DROP TABLE service;
    DROP TABLE staff;
    DROP TABLE tenant;
  `);
};