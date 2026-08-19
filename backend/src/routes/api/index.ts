// routes/api/index.ts
import { Router } from 'express';
import { resolveTenantFromSession } from '../../middleware/tenant.js';
// ...

const router = Router();
router.use(resolveTenantFromSession);   // every route below this line has req.tenantId set
// ...
export default router;