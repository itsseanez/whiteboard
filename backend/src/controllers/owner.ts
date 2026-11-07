// Owner endpoints under /tenant/:slug. resolveTenantFromSession and
// requireOwner have already run, so req.tenant is the caller's own tenant.
//
//   400  the body is malformed, or names staff/resources this tenant doesn't have
//   404  no such id in this tenant (another tenant's id looks the same)
//   409  a delete would strand future bookings

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { parseWeeklyHours } from '../lib/weekly-hours.js';
import * as owner from '../services/owner.js';
import { scope } from '../lib/scope.js';
import { closeOrganization } from '../services/close-organization.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME_MAX = 120;

type Handler = (req: Request, res: Response) => Promise<unknown>;

// One place maps the service errors to statuses.
function handle(fn: Handler): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof owner.NotFoundError) return res.status(404).json({ error: 'not_found' });
      if (err instanceof owner.UnknownLinkError) return res.status(400).json({ error: 'unknown_staff_or_resource' });
      if (err instanceof owner.OnlyResourceError) {
        return res.status(409).json({ error: 'only_resource_for_service', services: err.services });
      }
      if (err instanceof owner.HasFutureAppointmentsError) {
        return res.status(409).json({ error: 'has_future_appointments', count: err.count });
      }
      next(err);
    }
  };
}

function parseName(body: unknown): string | null {
  const name = (body as { name?: unknown } | null)?.name;
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= NAME_MAX ? trimmed : null;
}

function idParam(req: Request): string | null {
  const id = req.params.id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

function intIn(value: unknown, min: number, max: number): number | null {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max ? (value as number) : null;
}

function uuidList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && UUID.test(v))) return null;
  return [...new Set(value as string[])];
}

type ParsedService = { ok: true; value: owner.ServiceInput } | { ok: false; error: string };

function parseService(body: unknown): ParsedService {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = parseName(body);
  if (!name) return { ok: false, error: `name must be 1 to ${NAME_MAX} characters` };
  const durationMinutes = intIn(b.durationMinutes, 5, 24 * 60);
  if (durationMinutes === null) return { ok: false, error: 'durationMinutes must be a whole number from 5 to 1440' };
  const bufferBeforeMinutes = intIn(b.bufferBeforeMinutes ?? 0, 0, 240);
  const bufferAfterMinutes = intIn(b.bufferAfterMinutes ?? 0, 0, 240);
  if (bufferBeforeMinutes === null || bufferAfterMinutes === null) {
    return { ok: false, error: 'buffers must be whole minutes from 0 to 240' };
  }
  const minimumNoticeMinutes = intIn(b.minimumNoticeMinutes ?? 5, 0, 60 * 24 * 30);
  if (minimumNoticeMinutes === null) return { ok: false, error: 'minimumNoticeMinutes must be 0 to 43200' };
  const staffIds = uuidList(b.staffIds ?? []);
  const resourceIds = uuidList(b.resourceIds ?? []);
  if (!staffIds || !resourceIds) return { ok: false, error: 'staffIds and resourceIds must be arrays of uuids' };
  return {
    ok: true,
    value: { name, durationMinutes, bufferBeforeMinutes, bufferAfterMinutes, minimumNoticeMinutes, staffIds, resourceIds },
  };
}

// --- staff ---------------------------------------------------------------

export const getStaff = handle(async (req, res) => res.json(await owner.listStaff(scope(req))));

export const postStaff = handle(async (req, res) => {
  const name = parseName(req.body);
  if (!name) return res.status(400).json({ error: `name must be 1 to ${NAME_MAX} characters` });
  res.status(201).json(await owner.createStaff(scope(req), name));
});

export const patchStaff = handle(async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(404).json({ error: 'not_found' });
  const name = parseName(req.body);
  if (!name) return res.status(400).json({ error: `name must be 1 to ${NAME_MAX} characters` });
  await owner.renameStaff(scope(req), id, name);
  res.status(204).end();
});

export const putStaffHours = handle(async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(404).json({ error: 'not_found' });
  const parsed = parseWeeklyHours(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  await owner.replaceStaffHours(scope(req), id, parsed.value);
  res.json({ hours: parsed.value });
});

// --- business hours ------------------------------------------------------

export const getBusinessHours = handle(async (req, res) =>
  res.json({ hours: await owner.getBusinessHours(scope(req)) }),
);

export const putBusinessHours = handle(async (req, res) => {
  const parsed = parseWeeklyHours(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  await owner.replaceBusinessHours(scope(req), parsed.value);
  res.json({ hours: parsed.value });
});

// --- resources -----------------------------------------------------------

export const getResources = handle(async (req, res) => res.json(await owner.listResources(scope(req))));

export const postResource = handle(async (req, res) => {
  const name = parseName(req.body);
  if (!name) return res.status(400).json({ error: `name must be 1 to ${NAME_MAX} characters` });
  res.status(201).json(await owner.createResource(scope(req), name));
});

export const patchResource = handle(async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(404).json({ error: 'not_found' });
  const name = parseName(req.body);
  if (!name) return res.status(400).json({ error: `name must be 1 to ${NAME_MAX} characters` });
  await owner.renameResource(scope(req), id, name);
  res.status(204).end();
});

// --- services ------------------------------------------------------------

export const getServices = handle(async (req, res) => res.json(await owner.listServices(scope(req))));

export const postService = handle(async (req, res) => {
  const parsed = parseService(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  res.status(201).json(await owner.createService(scope(req), parsed.value));
});

export const putService = handle(async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(404).json({ error: 'not_found' });
  const parsed = parseService(req.body);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  res.json(await owner.updateService(scope(req), id, parsed.value));
});

// --- deletes (archive) ---------------------------------------------------

export const deleteStaff = handle(async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(404).json({ error: 'not_found' });
  await owner.archiveStaff(scope(req), id);
  res.status(204).end();
});

export const deleteService = handle(async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(404).json({ error: 'not_found' });
  await owner.archiveService(scope(req), id);
  res.status(204).end();
});

export const deleteResource = handle(async (req, res) => {
  const id = idParam(req);
  if (!id) return res.status(404).json({ error: 'not_found' });
  await owner.archiveResource(scope(req), id);
  res.status(204).end();
});

// DELETE /tenant/:slug { confirm: "<slug>" } — owner only (requireOwner).
// Closes the organization; the typed slug guards against a stray request.
export async function deleteOrganization(req: Request, res: Response) {
  const tenant = req.tenant!;
  const confirm = (req.body as { confirm?: unknown } | undefined)?.confirm;
  if (confirm !== tenant.slug) {
    return res.status(400).json({ error: 'confirm must be the organization’s address (its slug)' });
  }
  res.json(await closeOrganization(scope(req), tenant));
}
