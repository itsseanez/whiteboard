// types/express.d.ts
declare global {
  namespace Express {
    interface Request {
      tenant: Tenant;
    }
  }
}

export {};   // forces this file to be treated as a module — required for declare global to merge