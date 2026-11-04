import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { auth } from '../src/lib/auth.js';

const app = createApp();
// Owner role: sets up states the app can't reach on its own, and cleans up.
const ownerPool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

const run = randomUUID().slice(0, 8);
const slugs: string[] = [];
const emails: string[] = [];

function slugFor(label: string): string {
  const slug = `p-${label}-${run}`;
  slugs.push(slug);
  return slug;
}

async function signUp(label: string): Promise<{ cookie: string; userId: string }> {
  const email = `provision-${label}-${run}@test.example`;
  emails.push(email);
  const res = await request(app)
    .post('/api/auth/sign-up/email')
    .send({ name: label, email, password: 'test-password-123' });
  const cookies = res.headers['set-cookie'] as unknown as string[];
  const cookie = cookies?.find((c) => c.startsWith('better-auth.session_token='));
  if (!cookie) throw new Error(`Sign-up did not return a session cookie (${res.status})`);
  return { cookie, userId: res.body.user.id };
}

function provision(cookie: string, body: Record<string, unknown>) {
  return request(app).post('/me/tenants').set('Cookie', cookie).send(body);
}

const body = (slug: string) => ({ name: 'Test Salon', slug, timezone: 'Europe/Vienna' });

async function countTenants(slug: string): Promise<number> {
  const { rows } = await ownerPool.query('SELECT count(*)::int AS n FROM tenant WHERE slug = $1', [slug]);
  return rows[0].n;
}

async function countOrgs(slug: string): Promise<number> {
  const { rows } = await ownerPool.query('SELECT count(*)::int AS n FROM organization WHERE slug = $1', [slug]);
  return rows[0].n;
}

afterAll(async () => {
  await ownerPool.query('DELETE FROM tenant WHERE slug = ANY($1)', [slugs]);
  await ownerPool.query(
    'DELETE FROM member WHERE "organizationId" IN (SELECT id FROM organization WHERE slug = ANY($1))',
    [slugs],
  );
  await ownerPool.query('DELETE FROM organization WHERE slug = ANY($1)', [slugs]);
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
});

describe('POST /me/tenants', () => {
  it('provisions a tenant its owner can then reach', async () => {
    const slug = slugFor('happy');
    const { cookie } = await signUp('happy');

    const res = await provision(cookie, body(slug));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ slug });

    // Signed in fresh, as the brief's check asks.
    const signIn = await request(app)
      .post('/api/auth/sign-in/email')
      .send({ email: `provision-happy-${run}@test.example`, password: 'test-password-123' });
    const fresh = (signIn.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('better-auth.session_token='),
    )!;

    const tenant = await request(app).get(`/tenant/${slug}`).set('Cookie', fresh);
    expect(tenant.status).toBe(200);
    expect(tenant.body.tenant.slug).toBe(slug);
    expect(tenant.body.membership.role).toBe('owner');

    const mine = await request(app).get('/me/organizations').set('Cookie', fresh);
    expect(mine.body.map((m: { slug: string }) => m.slug)).toContain(slug);

    const page = await request(app).get(`/${slug}/services`);
    expect(page.status).toBe(200);
  });

  it('requires a session', async () => {
    const res = await request(app).post('/me/tenants').send(body(slugFor('anon')));
    expect(res.status).toBe(401);
  });

  describe('refuses bad input before writing anything', () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ['reserved slug', { name: 'X', slug: 'signin', timezone: 'Europe/Vienna' }, 'reserved_slug'],
      ['bad slug shape', { name: 'X', slug: 'Bad--Slug', timezone: 'Europe/Vienna' }, 'invalid_slug'],
      ['short slug', { name: 'X', slug: 'ab', timezone: 'Europe/Vienna' }, 'invalid_slug'],
      ['invented timezone', { name: 'X', slug: 'valid-slug-tz', timezone: 'Mars/Olympus' }, 'invalid_timezone'],
      ['offset timezone', { name: 'X', slug: 'valid-slug-tz', timezone: '+01:00' }, 'invalid_timezone'],
      ['blank name', { name: '   ', slug: 'valid-slug-nm', timezone: 'Europe/Vienna' }, 'invalid_name'],
      ['long name', { name: 'x'.repeat(81), slug: 'valid-slug-nm', timezone: 'Europe/Vienna' }, 'invalid_name'],
    ];

    it.each(cases)('%s', async (label, input, error) => {
      const { cookie } = await signUp(`bad-${label.replace(/\W+/g, '-')}`);
      const res = await provision(cookie, input);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(error);
      expect(await countOrgs(String(input.slug))).toBe(0);
    });
  });

  it('stores the canonical spelling of the timezone', async () => {
    const slug = slugFor('tzcase');
    const { cookie } = await signUp('tzcase');
    const res = await provision(cookie, { name: 'Case', slug, timezone: 'europe/vienna' });
    expect(res.status).toBe(201);
    const { rows } = await ownerPool.query('SELECT timezone FROM tenant WHERE slug = $1', [slug]);
    expect(rows[0].timezone).toBe('Europe/Vienna');
  });

  it("reports slug_taken for another account's tenant, without creating an org", async () => {
    const slug = slugFor('taken');
    const first = await signUp('taken-a');
    const second = await signUp('taken-b');
    expect((await provision(first.cookie, body(slug))).status).toBe(201);

    const res = await provision(second.cookie, body(slug));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('slug_taken');
    expect(await countOrgs(slug)).toBe(1);
  });

  it('reports slug_taken for an unlinked tenant, without creating an org', async () => {
    // The state the seed migration leaves before seed-auth backfills the link.
    const slug = slugFor('unlinked');
    await ownerPool.query(
      `INSERT INTO tenant (name, slug, timezone) VALUES ('Unlinked', $1, 'Europe/Vienna')`,
      [slug],
    );
    const { cookie } = await signUp('unlinked');

    const res = await provision(cookie, body(slug));
    expect(res.status).toBe(409);
    expect(await countOrgs(slug)).toBe(0);
  });

  it("reports slug_taken for another account's organization with no tenant", async () => {
    const slug = slugFor('orgtaken');
    const other = await signUp('orgtaken-a');
    await auth.api.createOrganization({ body: { name: 'Other', slug, userId: other.userId } });
    const { cookie } = await signUp('orgtaken-b');

    const res = await provision(cookie, body(slug));
    expect(res.status).toBe(409);
    expect(await countTenants(slug)).toBe(0);
  });

  it('resumes from its own organization with no tenant', async () => {
    const slug = slugFor('resume');
    const { cookie, userId } = await signUp('resume');
    const org = await auth.api.createOrganization({ body: { name: 'Mine', slug, userId } });

    const res = await provision(cookie, body(slug));
    expect(res.status).toBe(201);
    expect(await countOrgs(slug)).toBe(1);
    const { rows } = await ownerPool.query('SELECT better_auth_org_id FROM tenant WHERE slug = $1', [slug]);
    expect(rows[0].better_auth_org_id).toBe(org!.id);
  });

  it('answers ok to a retry after full success, without a second tenant', async () => {
    const slug = slugFor('retry');
    const { cookie } = await signUp('retry');
    expect((await provision(cookie, body(slug))).status).toBe(201);

    const again = await provision(cookie, body(slug));
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ slug });
    expect(await countTenants(slug)).toBe(1);
  });

  it('reports slug_taken for an organization with no member (accepted gap)', async () => {
    // createMember failed after the org insert. Indistinguishable from someone
    // else's org, so the slug stays held. Accepted for now.
    const slug = slugFor('orphan');
    await ownerPool.query(
      `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, 'Orphan', $2, now())`,
      [randomUUID(), slug],
    );
    const { cookie } = await signUp('orphan');

    const res = await provision(cookie, body(slug));
    expect(res.status).toBe(409);
    expect(await countTenants(slug)).toBe(0);
  });

  it('answers unknown /me paths itself instead of the /:slug router', async () => {
    const { cookie } = await signUp('notfound');
    const res = await request(app).get('/me/appointments').set('Cookie', cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not found');
  });
});
