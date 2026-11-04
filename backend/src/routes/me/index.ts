import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { createTenant, listOrganizations } from '../../controllers/me.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.get('/organizations', listOrganizations);
router.post('/tenants', createTenant);
export default router;
