// GET /tenant/:slug/appointments/:id/history — owners and managers.

import type { Request, Response } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { scope } from '../lib/scope.js';
import { appointmentHistory } from '../services/history.js';
import { NotFoundError } from '../services/owner.js';
import type { TenantWithOrg } from '../services/tenant.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getHistory(req: Request, res: Response) {
  const id = req.params.id;
  if (typeof id !== 'string' || !UUID.test(id)) return res.status(404).json({ error: 'not_found' });
  try {
    const events = await appointmentHistory(scope(req), (req.tenant as TenantWithOrg).betterAuthOrgId, id, fromNodeHeaders(req.headers));
    res.json({ timeZone: req.tenant!.timezone, events });
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ error: 'not_found' });
    throw error;
  }
}
