// src/routes/public/index.ts
import { Router } from 'express';
import { resolveTenantFromSlug } from '../../middleware/tenant.js';
import { getPublicAvailability } from '../../controllers/availability.js';
import { getPublicServices } from '../../controllers/catalog.js';
import { postPublicBooking } from '../../controllers/booking.js';
import {
  postCancelBooking,
  postRescheduleBooking,
} from '../../controllers/manage-booking.js';

const router = Router({ mergeParams: true });
router.use(resolveTenantFromSlug); // every route below this line has req.tenant set

// GET /:slug/services
//
// The salon's name and zone, plus what it offers and who can do it. The
// booking page's first request: every other endpoint here needs a serviceId,
// and nothing else hands one out.
router.get('/services', getPublicServices);

// GET /:slug/availability?serviceId=<uuid>&from=2026-10-24&through=2026-10-26&staffId=<uuid>
//
// `through` defaults to `from`, so a single-day request can omit it. `staffId`
// narrows the candidates to one stylist; without it every stylist qualified for
// the service is considered.
router.get('/availability', getPublicAvailability);

// POST /:slug/appointments
//
// { serviceId, staffId, startsAt, customer: { name, email, phone? } }
//
// `startsAt` is an instant copied back from an availability response, not a
// local time — the client never has to know the salon's zone to book.
router.post('/appointments', postPublicBooking);

// POST /:slug/appointments/cancel      { token }
// POST /:slug/appointments/reschedule  { token, startsAt, staffId? }
//
// The manage token travels in the body, never the path, so it stays out of
// access logs and Referer headers. Both are POST because the link in a
// confirmation email is followed by a browser — and by mail-client prefetchers
// and link scanners — so no GET may mutate anything.
//
// Registered after POST /appointments; Express matches on the full path, so
// these never shadow it.
router.post('/appointments/cancel', postCancelBooking);
router.post('/appointments/reschedule', postRescheduleBooking);

// Mounted last so it only catches paths no route above claimed. Without it an
// unknown path under /:slug falls through to Express's HTML 404, which is a
// jarring thing for a JSON client to receive.
router.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default router;
