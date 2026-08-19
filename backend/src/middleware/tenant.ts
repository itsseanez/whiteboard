// middleware/tenant.ts
import type { RequestHandler } from 'express';
import { getTenantBySlug } from '../services/tenant.js';

type TenantParams = {
  slug: string;
};

export const resolveTenantFromSession: RequestHandler = async (req, res, next) => {
    // your logic: session -> organization -> tenant
    // on success: req.tenantId = ...; next();
    // on failure: what should happen? that's the hole to think through.
};

export const resolveTenantFromSlug: RequestHandler<TenantParams> = async (req, res, next) => {
    // your logic: req.params.slug -> tenant
    // unresolved slug -> ?
    try {
        const { slug } = req.params
        const tenant = await getTenantBySlug(slug);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }
        req.tenant = tenant;
        next();
    } catch (error) {
        next(error);
    }
};