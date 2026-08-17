exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE tenant ADD COLUMN better_auth_org_id text REFERENCES organization(id);
    CREATE UNIQUE INDEX tenant_better_auth_org_id_idx ON tenant(better_auth_org_id);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    ALTER TABLE tenant DROP COLUMN better_auth_org_id;
  `);
};