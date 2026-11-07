// routes/api/index.ts
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { resolveTenantFromSession } from '../../middleware/tenant.js';
import { requireManager, requireOwner } from '../../middleware/roles.js';
import { getContext } from '../../controllers/tenants.js';
import * as owner from '../../controllers/owner.js';
import * as calendar from '../../controllers/owner-calendar.js';
import * as people from '../../controllers/people.js';
import * as myWeek from '../../controllers/my-week.js';

const router = Router({ mergeParams: true });
router.use(requireAuth);
router.use(resolveTenantFromSession); // every route below this line has req.tenant and req.membership set
router.get('/', getContext);
router.delete('/', requireOwner, owner.deleteOrganization);

// A staff member's own page. 404 not_staff for a member with no staff row.
router.get('/me/week', myWeek.getMyWeek);
router.put('/me/hours', myWeek.putMyHours);

// Setup, calendar and people: owners and managers. Deleting staff, a service
// or a resource archives it, and is refused while future bookings depend on it.
router.use(requireManager);
router.get('/people', people.getPeople);
router.post('/invitations', people.postInvitation);
router.delete('/members/:memberId', requireOwner, people.deleteMember);
router.get('/staff', owner.getStaff);
router.post('/staff', owner.postStaff);
router.patch('/staff/:id', owner.patchStaff);
router.put('/staff/:id/hours', owner.putStaffHours);
router.delete('/staff/:id', owner.deleteStaff);
router.get('/business-hours', owner.getBusinessHours);
router.put('/business-hours', owner.putBusinessHours);
router.get('/resources', owner.getResources);
router.post('/resources', owner.postResource);
router.patch('/resources/:id', owner.patchResource);
router.delete('/resources/:id', owner.deleteResource);
router.get('/services', owner.getServices);
router.post('/services', owner.postService);
router.put('/services/:id', owner.putService);
router.delete('/services/:id', owner.deleteService);
router.get('/calendar', calendar.getOwnerCalendar);
router.get('/availability/explain', calendar.getExplain);
router.post('/appointments', calendar.postOwnerBooking);
router.post('/appointments/:id/cancel', calendar.postOwnerCancel);
router.post('/appointments/:id/reschedule', calendar.postOwnerReschedule);

router.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});
export default router;
