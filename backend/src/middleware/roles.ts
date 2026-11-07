import type { RequestHandler } from 'express';

// Better Auth's organization roles, as Whiteboard uses them. "admin" is shown
// as manager: everything an owner does except inviting or removing managers.
export const OWNER = 'owner';
export const MANAGER = 'admin';
export const STAFF = 'member';

export const isManager = (role: string | undefined) => role === OWNER || role === MANAGER;

// After resolveTenantFromSession.
export const requireManager: RequestHandler = (req, res, next) => {
  if (!isManager(req.membership?.role)) return res.status(403).json({ error: 'managers_only' });
  next();
};

export const requireOwner: RequestHandler = (req, res, next) => {
  if (req.membership?.role !== OWNER) return res.status(403).json({ error: 'owner_only' });
  next();
};
