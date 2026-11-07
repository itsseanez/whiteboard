import type { Request } from 'express';
import type { Scope } from '../services/owner.js';

/** The tenant and the signed-in caller, after resolveTenantFromSession. */
export function scope(req: Request): Scope {
  return { tenantId: req.tenant!.id, userId: req.session!.session.userId };
}
