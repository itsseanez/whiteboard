import type { RequestHandler } from 'express';

// After resolveTenantFromSession: only the tenant's owners may change its setup.
export const requireOwner: RequestHandler = (req, res, next) => {
  if (req.membership?.role !== 'owner') {
    return res.status(403).json({ error: 'owner_only' });
  }
  next();
};
