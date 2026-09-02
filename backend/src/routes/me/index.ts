import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { listOrganizations } from '../../controllers/me.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.get('/organizations', listOrganizations);
export default router;