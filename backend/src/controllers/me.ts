import type { Request, Response, NextFunction } from 'express';
import { getTenantsByUserId } from '../services/tenant.js';

export async function listOrganizations(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.session!.session.userId;
    const tenants = await getTenantsByUserId(userId);
    res.json(tenants);
  } catch (err) {
    next(err);
  }
}