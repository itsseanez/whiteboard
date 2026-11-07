// Sign-ins for a tenant under /tenant/:slug, and accepting under /me:
//   GET    /people                  members and pending invitations   (managers)
//   POST   /invitations             { email, role, staffId? }         (managers; manager invites: owner)
//   DELETE /members/:memberId       end a member's access             (owner)
//   POST   /me/invitations/:id/accept

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { scope } from '../lib/scope.js';
import { OWNER } from '../middleware/roles.js';
import type { TenantWithOrg } from '../services/tenant.js';
import { PeopleError, acceptInvitation, invite, listPeople, removeMember, type InviteInput } from '../services/people.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function handle(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof PeopleError) return res.status(err.status).json({ error: err.code });
      next(err);
    }
  };
}

// resolveTenantFromSession sets the org id; the public resolver doesn't.
const orgId = (req: Request) => (req.tenant as TenantWithOrg).betterAuthOrgId;
const headers = (req: Request) => fromNodeHeaders(req.headers);

function parseInvite(body: unknown): InviteInput | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || email.length > 254) return 'email must be an email address';
  if (b.role !== 'staff' && b.role !== 'manager') return 'role must be staff or manager';
  const staffId = typeof b.staffId === 'string' ? b.staffId : null;
  if (b.role === 'staff' && (!staffId || !UUID.test(staffId))) return 'a staff invite needs staffId';
  if (b.role === 'manager' && staffId !== null) return 'a manager invite takes no staffId';
  return { email, role: b.role, staffId };
}

export const getPeople = handle(async (req, res) => {
  res.json(await listPeople(scope(req), orgId(req), headers(req)));
});

export const postInvitation = handle(async (req, res) => {
  const input = parseInvite(req.body);
  if (typeof input === 'string') return res.status(400).json({ error: input });
  if (input.role === 'manager' && req.membership!.role !== OWNER) {
    return res.status(403).json({ error: 'owner_only' });
  }
  const from = { organizationName: req.tenant!.name, inviterName: req.session!.user.name };
  res.status(201).json(await invite(scope(req), orgId(req), input, from, headers(req)));
});

export const deleteMember = handle(async (req, res) => {
  const memberId = req.params.memberId;
  if (typeof memberId !== 'string' || memberId.length === 0) return res.status(404).json({ error: 'not_found' });
  await removeMember(scope(req), orgId(req), memberId, headers(req));
  res.status(204).end();
});

export const postAccept = handle(async (req, res) => {
  const id = req.params.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
    return res.status(404).json({ error: 'invitation_not_found' });
  }
  const { user } = req.session!;
  res.json(await acceptInvitation({ id: user.id, email: user.email }, id, headers(req)));
});
