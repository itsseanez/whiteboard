import 'dotenv/config';

exports.up = (pgm) => {
  pgm.sql(`
    CREATE ROLE whiteboard_app WITH LOGIN PASSWORD '${process.env.WHITEBOARD_APP_PASSWORD}';
    GRANT CONNECT ON DATABASE whiteboard TO whiteboard_app;
    GRANT USAGE ON SCHEMA public TO whiteboard_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO whiteboard_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE whiteboard IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO whiteboard_app;

    CREATE ROLE whiteboard_signup WITH LOGIN PASSWORD '${process.env.WHITEBOARD_SIGNUP_PASSWORD}';
    GRANT CONNECT ON DATABASE whiteboard TO whiteboard_signup;
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