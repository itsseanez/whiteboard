// An open organization always keeps at least one owner.
//
// Better Auth only stops the last owner demoting themselves, and only by
// counting first and updating after. Two owners demoting each other at the
// same moment would both count two owners and both succeed, leaving none.
//
// This trigger runs on every role change away from owner and every owner
// membership deleted (removal, or a user deleted and their memberships
// cascading). It locks the organization's row first, so changes to one
// organization's owners take turns; the count that follows is a new statement,
// which under READ COMMITTED sees whatever the previous turn committed.
//
// A closed organization, or one with no tenant, may lose its last owner: a
// closed one can't be run anyway, and its owner may delete their account.
//
// SECURITY DEFINER so the lock needs no UPDATE grant on organization for the
// auth role; it reads two tables and locks one row, nothing else.

exports.up = (pgm) => {
  pgm.sql(`
    CREATE FUNCTION keep_an_owner() RETURNS trigger
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      BEGIN
        IF TG_OP = 'UPDATE' AND NEW.role = 'owner' THEN
          RETURN NEW;
        END IF;
        PERFORM 1 FROM organization WHERE id = OLD."organizationId" FOR UPDATE;
        IF FOUND
          AND EXISTS (SELECT 1 FROM tenant WHERE better_auth_org_id = OLD."organizationId" AND archived_at IS NULL)
          AND NOT EXISTS (
            SELECT 1 FROM member
            WHERE "organizationId" = OLD."organizationId" AND role = 'owner' AND id <> OLD.id
          )
        THEN
          RAISE EXCEPTION 'an open organization needs an owner'
            USING ERRCODE = 'check_violation', CONSTRAINT = 'organization_keeps_an_owner';
        END IF;
        RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
      END
    $$;
    REVOKE ALL ON FUNCTION keep_an_owner() FROM PUBLIC;

    CREATE TRIGGER member_keeps_an_owner
      BEFORE UPDATE OF role OR DELETE ON member
      FOR EACH ROW
      WHEN (OLD.role = 'owner')
      EXECUTE FUNCTION keep_an_owner();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER member_keeps_an_owner ON member;
    DROP FUNCTION keep_an_owner();
  `);
};
