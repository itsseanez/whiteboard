// routes/api/index.ts
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { resolveTenantFromSession } from '../../middleware/tenant.js';
import { getContext } from '../../controllers/tenants.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.use(resolveTenantFromSession); // every route below this line has req.tenant and req.membership set
router.get('/', getContext); 

router.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});
export default router;