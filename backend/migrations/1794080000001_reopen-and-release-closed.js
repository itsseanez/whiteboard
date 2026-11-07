// What happens after closing. For 30 days an owner can reopen. After that the
// slug is released: the next sign-up that asks for it renames the closed
// organization out of the way (lazily, so nothing has to run on a schedule).
// Either way an old manage link can still tell its customer the organization
// closed, by looking its token up across tenants.
//
// The two functions that cross tenants are SECURITY DEFINER, so they run as
// the migration owner and bypass RLS. Each does one narrow thing, takes no
// caller-chosen tenant id, and is granted to the one role that needs it.

exports.up = (pgm) => {
  pgm.sql(`
    -- The single place the waiting period is defined.
    CREATE FUNCTION closed_slug_hold() RETURNS interval
      LANGUAGE sql IMMUTABLE AS $$ SELECT interval '30 days' $$;

    -- Renames a closed organization's slug out of the way once its hold is
    -- over. True when it released one. Organization and tenant change together.
    CREATE FUNCTION release_closed_slug(wanted text) RETURNS boolean
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DECLARE
        closed record;
        renamed text;
      BEGIN
        SELECT id, better_auth_org_id INTO closed FROM tenant
        WHERE slug = wanted AND archived_at IS NOT NULL AND archived_at <= now() - closed_slug_hold()
        FOR UPDATE;
        IF NOT FOUND THEN
          RETURN false;
        END IF;
        -- "--" can't appear in a slug anyone picks, so this can never be claimed.
        renamed := wanted || '--closed-' || replace(closed.id::text, '-', '');
        UPDATE tenant SET slug = renamed WHERE id = closed.id;
        UPDATE organization SET slug = renamed WHERE id = closed.better_auth_org_id;
        RETURN true;
      END
      $$;
    REVOKE ALL ON FUNCTION release_closed_slug(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION release_closed_slug(text) TO whiteboard_signup;

    -- The closed organization a manage token belongs to, if any. The token's
    -- hash is the secret; this tells its holder no more than the org's name.
    CREATE FUNCTION closed_organization_for_token(token_hash text)
      RETURNS TABLE (name text, closed_at timestamptz)
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT tenant.name, tenant.archived_at
        FROM appointment JOIN tenant ON tenant.id = appointment.tenant_id
        WHERE appointment.manage_token_hash = token_hash AND tenant.archived_at IS NOT NULL
      $$;
    REVOKE ALL ON FUNCTION closed_organization_for_token(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION closed_organization_for_token(text) TO whiteboard_public;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP FUNCTION closed_organization_for_token(text);
    DROP FUNCTION release_closed_slug(text);
    DROP FUNCTION closed_slug_hold();
  `);
};
