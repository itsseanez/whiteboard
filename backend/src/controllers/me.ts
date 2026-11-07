import type { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { getTenantsByUserId } from '../services/tenant.js';
import { parseTenantInput } from '../lib/tenant-input.js';
import { provisionTenant } from '../services/provision.js';
import { reopenOrganization } from '../services/close-organization.js';

export async function listOrganizations(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.session!.session.userId;
    const tenants = await getTenantsByUserId(userId);
    res.json(tenants);
  } catch (err) {
    next(err);
  }
}

// POST /me/tenants { name, slug, timezone }
export async function createTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = parseTenantInput(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }

    const userId = req.session!.session.userId;
    const outcome = await provisionTenant(parsed.value, userId, fromNodeHeaders(req.headers));

    switch (outcome.kind) {
      case 'created':
        return res.status(201).json({ slug: outcome.slug });
      case 'existing':
        return res.status(200).json({ slug: outcome.slug });
      case 'slug_taken':
        return res.status(409).json({ error: 'slug_taken' });
      case 'failed':
        return res.status(500).json({ error: 'provision_failed', detail: outcome.detail });
    }
  } catch (err) {
    next(err);
  }
}

// POST /me/tenants/:slug/reopen — the owner, within 30 days of closing.
export async function reopenTenant(req: Request, res: Response, next: NextFunction) {
  try {
    const slug = req.params.slug;
    if (typeof slug !== 'string') return res.status(404).json({ error: 'not_found' });
    const reopened = await reopenOrganization(req.session!.session.userId, slug);
    if (!reopened) return res.status(404).json({ error: 'not_reopenable' });
    res.json({ slug });
  } catch (err) {
    next(err);
  }
}
