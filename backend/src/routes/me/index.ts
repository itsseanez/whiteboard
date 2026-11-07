import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { createTenant, listOrganizations, reopenTenant } from '../../controllers/me.js';
import { postAccept } from '../../controllers/people.js';
import { getNotifications, postRead, postReadAll } from '../../controllers/notifications.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.get('/organizations', listOrganizations);
router.post('/tenants', createTenant);
router.post('/tenants/:slug/reopen', reopenTenant);
router.post('/invitations/:id/accept', postAccept);
router.get('/notifications', getNotifications);
router.post('/notifications/read-all', postReadAll);
router.post('/notifications/:id/read', postRead);

// Without this, an unknown /me/... path falls through to the public /:slug router.
router.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});
export default router;
