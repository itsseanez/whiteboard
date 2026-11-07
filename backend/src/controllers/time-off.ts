// /tenant/:slug/time-off, for every signed-in role:
//   GET              time off that hasn't ended (staff: only their own)
//   POST             { staffId?, startDate, startTime?, endDate?, endTime?, reason? }
//   DELETE /:id
//   POST   /:id/approve, /:id/decline   owners and managers, pending requests only
//
// Dates and times are wall clock in the organization's zone. staffId may be
// left out to mean "me". Who may touch which rows is RLS's call, not this file's.

import type { Request, Response } from 'express';
import { scope } from '../lib/scope.js';
import { parseTimeOff, timeOffSpan } from '../lib/time-off-span.js';
import { NotFoundError } from '../services/owner.js';
import {
  AlreadyDecidedError,
  DecideForbiddenError,
  NoStaffGivenError,
  TimeOffForbiddenError,
  addTimeOff,
  decideTimeOff,
  listTimeOff,
  removeTimeOff,
} from '../services/time-off.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getTimeOff(req: Request, res: Response) {
  res.json({ timeZone: req.tenant!.timezone, timeOff: await listTimeOff(scope(req), new Date()) });
}

export async function postTimeOff(req: Request, res: Response) {
  const staffId = (req.body as { staffId?: unknown } | undefined)?.staffId;
  if (staffId !== undefined && staffId !== null && staffId !== '' && (typeof staffId !== 'string' || !UUID.test(staffId))) {
    return res.status(400).json({ error: 'staffId must be a uuid' });
  }
  const parsed = parseTimeOff(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  const span = timeOffSpan(parsed.value, req.tenant!.timezone);
  if (!span.ok) return res.status(400).json({ error: span.error });

  try {
    const added = await addTimeOff(scope(req), (staffId as string) || null, span.value, parsed.value.reason ?? null);
    res.status(201).json(added);
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ error: 'staff_not_found' });
    if (error instanceof TimeOffForbiddenError) return res.status(403).json({ error: 'own_time_off_only' });
    if (error instanceof NoStaffGivenError) return res.status(400).json({ error: 'staffId is required' });
    throw error;
  }
}

export async function deleteTimeOff(req: Request, res: Response) {
  const id = req.params.id;
  if (typeof id !== 'string' || !UUID.test(id)) return res.status(404).json({ error: 'not_found' });
  try {
    await removeTimeOff(scope(req), id);
    res.status(204).end();
  } catch (error) {
    if (error instanceof NotFoundError) return res.status(404).json({ error: 'not_found' });
    throw error;
  }
}

function decide(status: 'approved' | 'declined') {
  return async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== 'string' || !UUID.test(id)) return res.status(404).json({ error: 'not_found' });
    try {
      res.json(await decideTimeOff(scope(req), id, status));
    } catch (error) {
      if (error instanceof NotFoundError) return res.status(404).json({ error: 'not_found' });
      if (error instanceof AlreadyDecidedError) return res.status(409).json({ error: 'already_decided' });
      if (error instanceof DecideForbiddenError) return res.status(403).json({ error: 'managers_only' });
      throw error;
    }
  };
}

export const approveTimeOff = decide('approved');
export const declineTimeOff = decide('declined');
