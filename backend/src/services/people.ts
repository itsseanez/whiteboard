// Who can sign in to a tenant, and how they get there: invitations sent by
// owners and managers, accepted by the invitee, and linked to a staff row.
//
// Accepting spans two connections, Better Auth's and the app's, so like
// provisioning it can't be one transaction. Each step decides from what's in
// the database, so a retry picks up wherever the last attempt stopped.

import { auth } from '../lib/auth.js';
import { appPool } from '../db.js';
import { withContext } from '../withContext.js';
import { getMembershipByUserIdAndOrgId } from './tenant.js';
import { appUrl } from '../lib/mailer.js';
import { queueMail } from '../jobs/queue.js';
import type { Scope } from './owner.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNIQUE_VIOLATION = '23505';

export class PeopleError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

// --- inviting --------------------------------------------------------------

export interface InviteInput {
  email: string;
  role: 'staff' | 'manager';
  staffId: string | null;
}

/** A staff invite must name a staff row that's live and has no login yet. */
export async function requireInvitableStaff(scope: Scope, staffId: string): Promise<void> {
  const row = await withContext(appPool, scope, async (client) => {
    const { rows } = await client.query<{ archived: boolean; linked: boolean }>(
      `SELECT archived_at IS NOT NULL AS archived, user_id IS NOT NULL AS linked FROM staff WHERE id = $1`,
      [staffId],
    );
    return rows[0];
  });
  if (!row || row.archived) throw new PeopleError(404, 'not_found');
  if (row.linked) throw new PeopleError(409, 'staff_has_login');
}

/**
 * Queued here rather than sent from Better Auth's sendInvitationEmail, so the
 * outbox retries it. Useful for the invitation's seven days.
 */
export async function invite(
  scope: Scope,
  organizationId: string,
  input: InviteInput,
  from: { organizationName: string; inviterName: string },
  headers: Headers,
): Promise<{ invitationId: string }> {
  if (input.role === 'staff') await requireInvitableStaff(scope, input.staffId!);
  let invitationId: string;
  try {
    const invitation = await auth.api.createInvitation({
      body: {
        email: input.email,
        role: input.role === 'manager' ? 'admin' : 'member',
        organizationId,
        ...(input.staffId ? { staffId: input.staffId } : {}),
        resend: true, // inviting the same address again re-sends the email
      },
      headers,
    });
    invitationId = invitation.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (/already a member/i.test(message)) throw new PeopleError(409, 'already_member');
    if (/email/i.test(message)) throw new PeopleError(400, 'invalid_email');
    if (/allowed|owner can invite/i.test(message)) throw new PeopleError(403, 'owner_only');
    throw err;
  }

  const link = appUrl(`/invite/${invitationId}?email=${encodeURIComponent(input.email)}`);
  await queueMail(
    {
      to: input.email,
      subject: `Join ${from.organizationName} on Whiteboard`,
      text:
        `${from.inviterName} invited you to ${from.organizationName} as ${input.role === 'manager' ? 'a manager' : 'a staff member'}.\n\n` +
        `Accept the invitation: ${link}\n\n` +
        `The link works for 7 days. If you weren't expecting this, ignore it.`,
    },
    { hours: 24 * 7 },
  );
  return { invitationId };
}

// --- listing -----------------------------------------------------------------

export interface Person {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  staffId: string | null;
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  staffId: string | null;
  expiresAt: string;
}

export async function listPeople(
  scope: Scope,
  organizationId: string,
  headers: Headers,
): Promise<{ members: Person[]; invitations: PendingInvitation[] }> {
  const [{ members }, invitations, links] = await Promise.all([
    auth.api.listMembers({ query: { organizationId, limit: 500 }, headers }),
    auth.api.listInvitations({ query: { organizationId }, headers }),
    withContext(appPool, scope, async (client) => {
      const { rows } = await client.query<{ id: string; userId: string }>(
        `SELECT id, user_id AS "userId" FROM staff WHERE user_id IS NOT NULL AND archived_at IS NULL`,
      );
      return rows;
    }),
  ]);
  const staffOf = new Map(links.map((l) => [l.userId, l.id]));
  return {
    members: members.map((m) => ({
      memberId: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      staffId: staffOf.get(m.userId) ?? null,
    })),
    invitations: invitations
      .filter((i) => i.status === 'pending' && new Date(i.expiresAt) > new Date())
      .map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        staffId: (i as { staffId?: string | null }).staffId ?? null,
        expiresAt: new Date(i.expiresAt).toISOString(),
      })),
  };
}

// --- removing ------------------------------------------------------------------

/** Owner only. Ends the member's access and frees their staff row for a new invite. */
export async function removeMember(
  scope: Scope,
  organizationId: string,
  memberId: string,
  headers: Headers,
): Promise<void> {
  const { members } = await auth.api.listMembers({ query: { organizationId, limit: 500 }, headers });
  const member = members.find((m) => m.id === memberId);
  if (!member) throw new PeopleError(404, 'not_found');
  if (member.role === 'owner') throw new PeopleError(409, 'cannot_remove_owner');
  await auth.api.removeMember({ body: { memberIdOrEmail: memberId, organizationId }, headers });
  await withContext(appPool, scope, (client) =>
    client.query('UPDATE staff SET user_id = NULL WHERE user_id = $1', [member.userId]),
  );
}

// --- changing roles --------------------------------------------------------------

export type AppRole = 'owner' | 'manager' | 'staff';
const AUTH_ROLE: Record<AppRole, string> = { owner: 'owner', manager: 'admin', staff: 'member' };

/** The member_keeps_an_owner trigger refused, however Better Auth wrapped it. */
function lostLastOwner(err: unknown): boolean {
  for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
    const { constraint, message } = e as { constraint?: string; message?: string };
    if (constraint === 'organization_keeps_an_owner' || /needs an owner|without an owner/i.test(message ?? '')) return true;
  }
  return false;
}

/**
 * Owner only. Any role to any member, the caller included. Better Auth checks
 * who may set what; the database refuses leaving an open organization ownerless.
 */
export async function changeRole(
  organizationId: string,
  memberId: string,
  role: AppRole,
  headers: Headers,
): Promise<void> {
  try {
    await auth.api.updateMemberRole({ body: { memberId, role: AUTH_ROLE[role], organizationId }, headers });
  } catch (err) {
    if (lostLastOwner(err)) throw new PeopleError(409, 'last_owner');
    const message = err instanceof Error ? err.message : '';
    if (/member not found/i.test(message)) throw new PeopleError(404, 'not_found');
    if (/not allowed/i.test(message)) throw new PeopleError(403, 'owner_only');
    throw err;
  }
}

// --- accepting -------------------------------------------------------------------

interface InvitationRow {
  organizationId: string;
  email: string;
  role: string;
  status: string;
  staffId: string | null;
  expiresAt: Date;
}

export async function acceptInvitation(
  user: { id: string; email: string },
  invitationId: string,
  headers: Headers,
): Promise<{ slug: string; role: string }> {
  const { rows } = await appPool.query<InvitationRow>(
    `SELECT "organizationId", email, role, status, "staffId", "expiresAt" FROM invitation WHERE id = $1`,
    [invitationId],
  );
  const invitation = rows[0];
  if (!invitation) throw new PeopleError(404, 'invitation_not_found');
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) throw new PeopleError(403, 'wrong_account');

  if (invitation.status === 'pending') {
    if (invitation.expiresAt <= new Date()) throw new PeopleError(410, 'invitation_expired');
    // Its error isn't trusted either way; the membership check below decides.
    await auth.api.acceptInvitation({ body: { invitationId }, headers }).catch(() => undefined);
  } else if (invitation.status !== 'accepted') {
    throw new PeopleError(410, 'invitation_closed');
  }

  const membership = await getMembershipByUserIdAndOrgId(user.id, invitation.organizationId);
  if (!membership) throw new PeopleError(409, 'accept_failed');

  const tenant = await withContext(appPool, { userId: user.id }, async (client) => {
    const { rows } = await client.query<{ id: string; slug: string }>(
      'SELECT id, slug FROM tenant WHERE better_auth_org_id = $1',
      [invitation.organizationId],
    );
    return rows[0];
  });
  if (!tenant) throw new PeopleError(404, 'invitation_not_found');

  if (invitation.staffId && UUID.test(invitation.staffId)) {
    await linkStaff({ tenantId: tenant.id, userId: user.id }, invitation.staffId);
  }
  return { slug: tenant.slug, role: membership.role };
}

/** Ties the staff row to the caller; a no-op when it already is. */
async function linkStaff(scope: Scope, staffId: string): Promise<void> {
  await withContext(appPool, scope, async (client) => {
    try {
      const { rowCount } = await client.query(
        `UPDATE staff SET user_id = $2
         WHERE id = $1 AND archived_at IS NULL AND (user_id IS NULL OR user_id = $2)`,
        [staffId, scope.userId],
      );
      if (rowCount === 0) throw new PeopleError(409, 'staff_unavailable');
    } catch (err) {
      // The caller already has a different staff row in this tenant.
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) throw new PeopleError(409, 'staff_unavailable');
      throw err;
    }
  });
}
