import 'dotenv/config';

exports.up = (pgm) => {
  const appPassword = process.env.WHITEBOARD_APP_PASSWORD;
  const signupPassword = process.env.WHITEBOARD_SIGNUP_PASSWORD;
  if (!signupPassword) throw new Error('WHITEBOARD_SIGNUP_PASSWORD not set');
  if (!appPassword) throw new Error('WHITEBOARD_APP_PASSWORD not set');
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'whiteboard_app') THEN
        EXECUTE format('CREATE ROLE whiteboard_app WITH LOGIN PASSWORD %L', $pw$${appPassword}$pw$);
      END IF;
    END
    $$;

    DO $$
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO whiteboard_app', current_database());
    END
    $$;
    GRANT USAGE ON SCHEMA public TO whiteboard_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO whiteboard_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE whiteboard IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO whiteboard_app;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'whiteboard_signup') THEN
        EXECUTE format('CREATE ROLE whiteboard_signup WITH LOGIN PASSWORD %L', $pw$${signupPassword}$pw$);
      END IF;
    END
    $$;

    DO $$
    BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO whiteboard_signup', current_database());
    END
    $$;
    GRANT USAGE ON SCHEMA public TO whiteboard_signup;
    GRANT INSERT ON tenant TO whiteboard_signup;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    REVOKE INSERT ON tenant FROM whiteboard_signup;
    DROP ROLE whiteboard_signup;

    ALTER DEFAULT PRIVILEGES FOR ROLE whiteboard IN SCHEMA public
    REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM whiteboard_app;
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM whiteboard_app;
    DROP ROLE whiteboard_app;
  `);
};