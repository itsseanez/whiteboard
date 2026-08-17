// scripts/seed-auth.ts
import { auth } from '../src/lib/auth.js';
import { pool } from '../src/db.js';
import { Pool } from 'pg';

// Owner-level connection, used only for the cross-tenant backfill below —
// RLS on `tenant` scopes UPDATEs to a single tenant_id, but this script
// legitimately needs to write both tenants' rows in one pass.
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });

async function ensureUser(name: string, email: string, password: string) {
  try {
    const result = await auth.api.signUpEmail({ body: { name, email, password } });
    console.log(`Created user ${email}`);
    return result;
  } catch (err: any) {
    if (err?.body?.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
      console.log(`User ${email} already exists, reusing.`);
      const result = await pool.query('SELECT id FROM "user" WHERE email = $1', [email]);
      return { user: result.rows[0] };
    }
    throw err;
  }
}

async function ensureOrganization(name: string, slug: string, userId: string) {
  try {
    const result = await auth.api.createOrganization({ body: { name, slug, userId } });
    console.log(`Created organization ${slug}`);
    return result;
  } catch (err: any) {
    console.log(`Organization ${slug} may already exist, reusing. (${err?.body?.code ?? err.message})`);
    const result = await pool.query('SELECT id FROM organization WHERE slug = $1', [slug]);
    return { id: result.rows[0]?.id };
  }
}

async function main() {
  const userA = await ensureUser('Marina Lopez', 'marina@marinascuts.example', 'demo-password-123');
  const userB = await ensureUser('Anna Huber', 'anna@studiowien.example', 'demo-password-123');

  const orgA = await ensureOrganization("Marina's Cuts & Color", 'marinas-cuts-color', userA.user.id);
  const orgB = await ensureOrganization('Studio Wien', 'studio-wien', userB.user.id);

  if (!orgA.id || !orgB.id) {
    throw new Error('Failed to resolve organization id — check createOrganization error output above.');
  }

  // Owner pool here — bypasses RLS, since this backfill spans both tenants at once.
  await ownerPool.query(`UPDATE tenant SET better_auth_org_id = $1 WHERE slug = $2`, [orgA.id, 'marinas-cuts-color']);
  await ownerPool.query(`UPDATE tenant SET better_auth_org_id = $1 WHERE slug = $2`, [orgB.id, 'studio-wien']);

  console.log('\nSeed complete:');
  console.log(`  marina@marinascuts.example / demo-password-123 -> marinas-cuts-color`);
  console.log(`  anna@studiowien.example / demo-password-123 -> studio-wien`);

  await pool.end();
  await ownerPool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});