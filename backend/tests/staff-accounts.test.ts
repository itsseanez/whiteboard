import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { Pool } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { outbox } from '../src/lib/mailer.js';
import { appPool } from '../src/db.js';
import { withContext } from '../src/withContext.js';

// Invitations, accepting them, and what each role can then reach. The row
// checks go straight at the database as whiteboard_app, because the point is
// that RLS holds even if a route forgot to.
const app = createApp();
const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });

const run = randomUUID().slice(0, 8);
const slug = `people-${run}`;
const emails: string[] = [];
const email = (label: string) => {
  const e = `${label}-${run}@test.example`;
  emails.push(e);
  return e;
};

let owner = '';
let tenantId = '';
let orgId = '';
let anna = ''; // staff row ids
let ben = '';
let annaCustomer = '';
let benCustomer = '';

function cookieOf(res: request.Response): string {
  const found = (res.headers['set-cookie'] as unknown as string[] | undefined)?.find((c) =>
    c.startsWith('better-auth.session_token='),
  );
  if (!found) throw new Error(`No session (${res.status})`);
  return found;
}

async function signUp(address: string): Promise<{ cookie: string; userId: string }> {
  const res = await request(app)
    .post('/api/auth/sign-up/email')
    .send({ name: address.split('-')[0], email: address, password: 'test-password-123' });
  return { cookie: cookieOf(res), userId: res.body.user.id };
}

const api = {
  get: (path: string, c: string) => request(app).get(`/tenant/${slug}${path}`).set('Cookie', c),
  post: (path: string, body: object, c: string) => request(app).post(`/tenant/${slug}${path}`).set('Cookie', c).send(body),
  put: (path: string, body: object, c: string) => request(app).put(`/tenant/${slug}${path}`).set('Cookie', c).send(body),
  delete: (path: string, c: string) => request(app).delete(`/tenant/${slug}${path}`).set('Cookie', c),
};

/** The invitation id from the newest email to this address. */
function invitationFor(address: string): string {
  const mail = [...outbox].reverse().find((m) => m.to === address && m.text.includes('/invite/'));
  const id = mail?.text.match(/\/invite\/([^?\s]+)/)?.[1];
  if (!id) throw new Error(`No invitation email to ${address}`);
  return id;
}

async function invitedAndAccepted(label: string, role: 'staff' | 'manager', staffId: string | null, by = owner) {
  const address = email(label);
  const sent = await api.post('/invitations', { email: address, role, ...(staffId ? { staffId } : {}) }, by);
  expect(sent.status).toBe(201);
  const user = await signUp(address);
  const accepted = await request(app).post(`/me/invitations/${invitationFor(address)}/accept`).set('Cookie', user.cookie);
  expect(accepted.status).toBe(200);
  return { ...user, address };
}

async function appointment(staffId: string, customerId: string, serviceId: string, hour: number) {
  const starts = new Date(Date.UTC(2031, 0, 6, hour));
  const ends = new Date(starts.getTime() + 60 * 60 * 1000);
  await ownerPool.query(
    `INSERT INTO appointment (tenant_id, staff_id, service_id, customer_id, starts_at, ends_at,
                              blocked_starts_at, blocked_ends_at, manage_token_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $5, $6, $7)`,
    [tenantId, staffId, serviceId, customerId, starts, ends, randomBytes(32).toString('hex')],
  );
}

beforeAll(async () => {
  ({ cookie: owner } = await signUp(email('owner')));
  const res = await request(app).post('/me/tenants').set('Cookie', owner).send({ name: 'People Test', slug, timezone: 'UTC' });
  if (res.status !== 201) throw new Error(`Provisioning failed (${res.status})`);
  ({ id: tenantId, better_auth_org_id: orgId } = (
    await ownerPool.query('SELECT id, better_auth_org_id FROM tenant WHERE slug = $1', [slug])
  ).rows[0]);

  anna = (await api.post('/staff', { name: 'Anna' }, owner)).body.id;
  ben = (await api.post('/staff', { name: 'Ben' }, owner)).body.id;
  const service = (
    await ownerPool.query(
      `INSERT INTO service (tenant_id, name, duration_minutes) VALUES ($1, 'Cut', 60) RETURNING id`,
      [tenantId],
    )
  ).rows[0].id;
  const customer = async (name: string) =>
    (
      await ownerPool.query(`INSERT INTO customer (tenant_id, name, email) VALUES ($1, $2, $3) RETURNING id`, [
        tenantId,
        name,
        `${name.toLowerCase()}-${run}@customer.example`,
      ])
    ).rows[0].id;
  annaCustomer = await customer('Carla');
  benCustomer = await customer('Dora');
  await appointment(anna, annaCustomer, service, 9);
  await appointment(ben, benCustomer, service, 10);
});

afterAll(async () => {
  for (const table of ['appointment', 'customer', 'staff_service', 'service_resource', 'staff_working_hours', 'business_hours', 'time_off']) {
    await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  for (const table of ['service', 'staff', 'resource']) {
    await ownerPool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
  }
  await ownerPool.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
  await ownerPool.query('DELETE FROM invitation WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM member WHERE "organizationId" = $1', [orgId]);
  await ownerPool.query('DELETE FROM organization WHERE id = $1', [orgId]);
  await ownerPool.query('DELETE FROM "user" WHERE email = ANY($1)', [emails]);
  await ownerPool.end();
});

describe('inviting and accepting', () => {
  it('emails a link, and accepting links the staff row to the new login', async () => {
    const staff = await invitedAndAccepted('anna', 'staff', anna);
    const { rows } = await ownerPool.query('SELECT user_id FROM staff WHERE id = $1', [anna]);
    expect(rows[0].user_id).toBe(staff.userId);

    // A second click on the same link is fine.
    const again = await request(app).post(`/me/invitations/${invitationFor(staff.address)}/accept`).set('Cookie', staff.cookie);
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ slug, role: 'member' });
  });

  it('refuses an accept from a different account', async () => {
    const address = email('intended');
    await api.post('/invitations', { email: address, role: 'staff', staffId: ben }, owner);
    const stranger = await signUp(email('stranger'));
    const res = await request(app).post(`/me/invitations/${invitationFor(address)}/accept`).set('Cookie', stranger.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('wrong_account');
  });

  it('refuses to invite for a staff row that already has a login', async () => {
    const res = await api.post('/invitations', { email: email('second'), role: 'staff', staffId: anna }, owner);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('staff_has_login');
  });

  it('needs a staff row for a staff invite', async () => {
    const res = await api.post('/invitations', { email: email('nobody'), role: 'staff' }, owner);
    expect(res.status).toBe(400);
  });
});

describe('a staff member', () => {
  let staff: Awaited<ReturnType<typeof invitedAndAccepted>>;
  beforeAll(async () => {
    const row = (await api.post('/staff', { name: 'Eva' }, owner)).body.id;
    staff = await invitedAndAccepted('eva', 'staff', row);
    // Eva gets Anna's row instead, so she has an appointment to see.
    await ownerPool.query('UPDATE staff SET user_id = NULL WHERE id = $1', [anna]);
    await ownerPool.query('UPDATE staff SET user_id = NULL WHERE id = $1', [row]);
    await ownerPool.query('UPDATE staff SET user_id = $1 WHERE id = $2', [staff.userId, anna]);
  });

  it('is kept out of setup, the calendar and people', async () => {
    for (const path of ['/staff', '/calendar?from=2031-01-06', '/people']) {
      const res = await api.get(path, staff.cookie);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('managers_only');
    }
  });

  it('sees their own week, with only their own appointments', async () => {
    const res = await api.get('/me/week?from=2031-01-06&through=2031-01-12', staff.cookie);
    expect(res.status).toBe(200);
    expect(res.body.staff.map((s: { id: string }) => s.id)).toEqual([anna]);
    expect(res.body.appointments).toHaveLength(1);
    expect(res.body.appointments[0].customer.name).toBe('Carla');
  });

  it('can change their own hours', async () => {
    const res = await api.put('/me/hours', { hours: [{ weekday: 1, start: '09:00', end: '17:00' }] }, staff.cookie);
    expect(res.status).toBe(200);
  });

  describe('as whiteboard_app, under their own user', () => {
    const asStaff = <T>(fn: Parameters<typeof withContext<T>>[2]) =>
      withContext(appPool, { tenantId, userId: staff.userId }, fn);

    it("reads only their own appointments and customers", async () => {
      const appointments = await asStaff((c) => c.query('SELECT staff_id FROM appointment'));
      expect(appointments.rows.map((r) => r.staff_id)).toEqual([anna]);
      const customers = await asStaff((c) => c.query('SELECT id FROM customer'));
      expect(customers.rows.map((r) => r.id)).toEqual([annaCustomer]);
      const other = await asStaff((c) => c.query('SELECT id FROM customer WHERE id = $1', [benCustomer]));
      expect(other.rowCount).toBe(0);
    });

    it("cannot write another staff member's hours, or any appointment", async () => {
      await expect(
        asStaff((c) =>
          c.query(
            `INSERT INTO staff_working_hours (staff_id, tenant_id, weekday, start_time, end_time) VALUES ($1, $2, 2, '09:00', '10:00')`,
            [ben, tenantId],
          ),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      // Their own appointment is visible, so the update reaches it and WITH CHECK refuses.
      await expect(
        asStaff((c) => c.query(`UPDATE appointment SET status = 'CANCELLED' WHERE staff_id = $1`, [anna])),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('sees nothing once their staff row is archived', async () => {
      await ownerPool.query('UPDATE staff SET archived_at = now() WHERE id = $1', [anna]);
      try {
        const appointments = await asStaff((c) => c.query('SELECT id FROM appointment'));
        expect(appointments.rowCount).toBe(0);
      } finally {
        await ownerPool.query('UPDATE staff SET archived_at = NULL WHERE id = $1', [anna]);
      }
    });
  });

  it('loses access when the owner removes them', async () => {
    const people = await api.get('/people', owner);
    const member = people.body.members.find((m: { userId: string }) => m.userId === staff.userId);
    expect(member.staffId).toBe(anna);
    expect((await api.delete(`/members/${member.memberId}`, owner)).status).toBe(204);
    expect((await api.get('/me/week?from=2031-01-06', staff.cookie)).status).toBe(404);
    const { rows } = await ownerPool.query('SELECT user_id FROM staff WHERE id = $1', [anna]);
    expect(rows[0].user_id).toBeNull();
  });
});

describe('a manager', () => {
  let manager: Awaited<ReturnType<typeof invitedAndAccepted>>;
  beforeAll(async () => {
    manager = await invitedAndAccepted('mgr', 'manager', null);
  });

  it('runs setup and the calendar, and sees every appointment', async () => {
    expect((await api.get('/staff', manager.cookie)).status).toBe(200);
    const calendar = await api.get('/calendar?from=2031-01-06', manager.cookie);
    expect(calendar.status).toBe(200);
    expect(calendar.body.appointments).toHaveLength(2);
  });

  it('invites staff', async () => {
    const row = (await api.post('/staff', { name: 'Finn' }, manager.cookie)).body.id;
    const res = await api.post('/invitations', { email: email('finn'), role: 'staff', staffId: row }, manager.cookie);
    expect(res.status).toBe(201);
  });

  it('cannot invite another manager, here or through Better Auth directly', async () => {
    const res = await api.post('/invitations', { email: email('mgr2'), role: 'manager' }, manager.cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('owner_only');
    const direct = await request(app)
      .post('/api/auth/organization/invite-member')
      .set('Cookie', manager.cookie)
      .send({ email: email('mgr3'), role: 'admin', organizationId: orgId });
    expect(direct.status).toBe(403);
  });

  it('cannot remove members or change roles', async () => {
    const people = await api.get('/people', manager.cookie);
    const self = people.body.members.find((m: { userId: string }) => m.userId === manager.userId);
    expect((await api.delete(`/members/${self.memberId}`, manager.cookie)).status).toBe(403);
    const promote = await request(app)
      .post('/api/auth/organization/update-member-role')
      .set('Cookie', manager.cookie)
      .send({ memberId: self.memberId, role: 'owner', organizationId: orgId });
    expect(promote.status).toBe(403);
  });
});
