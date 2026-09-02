// middleware/tenant.ts
import type { RequestHandler } from 'express';
import { getTenantBySlug, getMembershipByUserIdAndOrgId } from '../services/tenant.js';

type TenantParams = {
  slug: string;
};

//Gets the membership of the user for the tenant's organization and attaches it to req.membership
export const resolveTenantFromSession: RequestHandler<TenantParams> = async (req, res, next) => {
    try {
        const { slug } = req.params;
        const session = req.session?.session;

        // If the session is not present or does not have a userId, return a 401 Unauthorized response
        if (!session?.userId) {
           return res.status(401).json({ error: 'Not authenticated' });
        }
        const tenant = await getTenantBySlug(slug, true, session.userId);

        // If the tenant request is not found associated with the user, return a 404 Not Found response
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        // Check if the user is a member of the tenant's organization
        const membership = await getMembershipByUserIdAndOrgId(session.userId, tenant.betterAuthOrgId);
        if (!membership) {
            return res.status(404).json({ error: 'Tenant not found' });
        }

        req.tenant = tenant;
        req.membership = membership; // Attach the membership to the request object
        next();
    } catch (error) {
        next(error);
    }
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