// types/express.d.ts
declare global {
  namespace Express {
    interface Request {
      tenant?: Tenant;
      tenants?: Tenant[];
      membership?: Membership;
      session?: {
        user: User;
        session: Session;
      };
    }
  }
}

export {};   // forces this file to be treated as a module — required for declare global to merge