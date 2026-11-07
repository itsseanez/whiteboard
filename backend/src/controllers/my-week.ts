// A staff member's own page under /tenant/:slug/me:
//   GET /me/week?from&through   their week: hours, time off, appointments
//   PUT /me/hours               replace their weekly hours
//
// Appointments come from the same calendar query the owner sees. RLS is what
// narrows it: a staff caller can only read their own appointments and those
// appointments' customers.

import type { Request, Response } from 'express';
import { appPool } from '../db.js';
import { withContext } from '../withContext.js';
import { parseWeeklyHours } from '../lib/weekly-hours.js';
import { scope } from '../lib/scope.js';
import { getCalendar } from '../services/calendar.js';
import { replaceStaffHours } from '../services/owner.js';
import { parseRange } from './owner-calendar.js';

async function ownStaffId(req: Request): Promise<string | null> {
  return withContext(appPool, scope(req), async (client) => {
    const { rows } = await client.query<{ id: string | null }>('SELECT app_caller_staff_id() AS id');
    return rows[0]?.id ?? null;
  });
}

export async function getMyWeek(req: Request, res: Response) {
  const range = parseRange(req);
  if (!range.ok) return res.status(400).json({ error: range.error });
  const staffId = await ownStaffId(req);
  if (!staffId) return res.status(404).json({ error: 'not_staff' });
  const calendar = await getCalendar(scope(req), req.tenant!.timezone, range.from, range.through);
  res.json({
    ...calendar,
    staff: calendar.staff.filter((s) => s.id === staffId),
    timeOff: calendar.timeOff.filter((t) => t.staffId === staffId),
    appointments: calendar.appointments.filter((a) => a.staffId === staffId),
  });
}

export async function putMyHours(req: Request, res: Response) {
  const staffId = await ownStaffId(req);
  if (!staffId) return res.status(404).json({ error: 'not_staff' });
  const parsed = parseWeeklyHours(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  await replaceStaffHours(scope(req), staffId, parsed.value);
  res.json({ hours: parsed.value });
}
