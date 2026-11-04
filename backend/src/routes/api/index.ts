// routes/api/index.ts
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { resolveTenantFromSession } from '../../middleware/tenant.js';
import { requireOwner } from '../../middleware/owner.js';
import { getContext } from '../../controllers/tenants.js';
import * as owner from '../../controllers/owner.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.use(resolveTenantFromSession); // every route below this line has req.tenant and req.membership set
router.get('/', getContext);

// Owner setup. Create and edit only; deletes wait until there is a policy for
// what happens to the appointments that reference a row.
router.use(requireOwner);
router.get('/staff', owner.getStaff);
router.post('/staff', owner.postStaff);
router.patch('/staff/:id', owner.patchStaff);
router.put('/staff/:id/hours', owner.putStaffHours);
router.get('/business-hours', owner.getBusinessHours);
router.put('/business-hours', owner.putBusinessHours);
router.get('/resources', owner.getResources);
router.post('/resources', owner.postResource);
router.patch('/resources/:id', owner.patchResource);
router.get('/services', owner.getServices);
router.post('/services', owner.postService);
router.put('/services/:id', owner.putService);

router.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});
export default router;
