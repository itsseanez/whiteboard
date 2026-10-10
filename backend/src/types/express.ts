import type { Tenant, Membership } from '../services/tenant.js';
import type { auth } from '../lib/auth.js';

type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

declare global {
  namespace Express {
    interface Request {
      tenant?: Tenant;
      tenants?: Tenant[];
      membership?: Membership;
      session?: AuthSession;
    }
  }
}

export { };
