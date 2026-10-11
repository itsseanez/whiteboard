// src/controllers/catalog.ts
//
// GET /:slug/services
//
// The booking page's first request. Returns the salon's name and zone with the
// services, so the page can render its header and format times without a
// second round trip — the availability response carries the zone too, but the
// page needs it before any service has been chosen.

import type { Request, Response } from 'express';
import { publicPool } from '../db.js';
import { getCatalog } from '../services/catalog.js';

export async function getPublicServices(req: Request, res: Response): Promise<void> {
  const tenant = req.tenant;
  if (!tenant?.id || !tenant.timezone) {
    res.status(400).json({ error: 'Tenant not resolved' });
    return;
  }

  const services = await getCatalog(publicPool, tenant.id);

  res.json({
    tenant: {
      name: tenant.name,
      slug: tenant.slug,
      timeZone: tenant.timezone,
    },
    services,
  });
}
