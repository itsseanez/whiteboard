import { MigrationBuilder } from 'node-pg-migrate';

export const shorthands = undefined;

export const up = (pgm) => {
  const password = process.env.WHITEBOARD_PUBLIC_PASSWORD;
  if (!password) {
    throw new Error(
      'WHITEBOARD_PUBLIC_PASSWORD is not set — check .env and dotenv load order before running this migration.'
    );
  }

  pgm.sql(`CREATE ROLE whiteboard_public WITH LOGIN PASSWORD '${password}';`);
  pgm.sql(`GRANT SELECT (id, name, slug, timezone) ON tenant TO whiteboard_public;`);
};

export const down = (pgm) => {
  pgm.sql(`REVOKE SELECT (id, name, slug, timezone) ON tenant FROM whiteboard_public;`);
  pgm.sql(`DROP ROLE IF EXISTS whiteboard_public;`);
};
