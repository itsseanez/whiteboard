import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { createTenant, listOrganizations } from '../../controllers/me.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.get('/organizations', listOrganizations);
router.post('/tenants', createTenant);

// Without this, an unknown /me/... path falls through to the public /:slug router.
router.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});
export default router;
