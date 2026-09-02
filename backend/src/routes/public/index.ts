// routes/public/index.ts
import { Router } from 'express';
import { resolveTenantFromSlug } from '../../middleware/tenant.js';

const router = Router({ mergeParams: true });
router.use(resolveTenantFromSlug); // every route below this line has req.tenant set
export default router;