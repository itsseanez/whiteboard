import 'dotenv/config';

exports.up = (pgm) => {
  const authPassword = process.env.WHITEBOARD_AUTH_PASSWORD;
  if (!authPassword) throw new Error('WHITEBOARD_AUTH_PASSWORD not set');

  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'whiteboard_auth') THEN
        EXECUTE format('CREATE ROLE whiteboard_auth WITH LOGIN PASSWORD %L', $pw$${authPassword}$pw$);
      END IF;
    END
    $$;

    DO $$
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO whiteboard_auth', current_database());
    END
    $$;

    GRANT USAGE ON SCHEMA public TO whiteboard_auth;

    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "user", "session", account, verification, organization, member, invitation
    TO whiteboard_auth;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE ALL ON
      "user", "session", account, verification, organization, member, invitation
    FROM whiteboard_auth;

    REVOKE USAGE ON SCHEMA public FROM whiteboard_auth;

    DO $$
    BEGIN
      EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM whiteboard_auth', current_database());
    END
    $$;

    DROP ROLE IF EXISTS whiteboard_auth;
  `);
};
