// POST /tenant/:slug/customers/:id/erase — owners only.

import type { Request, Response } from 'express';
import { scope } from '../lib/scope.js';
import { eraseCustomer } from '../services/customers.js';
import { HasFutureAppointmentsError, NotFoundError } from '../services/owner.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function postEraseCustomer(req: Request, res: Response) {
  const id = req.params.id;
  if (typeof id !== 'string' || !UUID.test(id)) return res.status(404).json({ error: 'not_found' });
  try {
    await eraseCustomer(scope(req), id);
    res.status(204).end();
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ error: 'not_found' });
    if (error instanceof HasFutureAppointmentsError) return res.status(409).json({ error: 'has_future_appointments' });
    throw error;
  }
}
