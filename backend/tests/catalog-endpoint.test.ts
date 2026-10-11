// backend/tests/catalog-endpoint.test.ts
//
// GET /:slug/services — the booking page's entry point. Read-only, so it
// creates nothing and needs no cleanup.

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

const WIEN_SLUG = 'studio-wien';
const MARINA_SLUG = 'marinas-cuts-color';
const COLOR_SERVICE = 'b2222222-2222-2222-2222-222222222222';
const CUT_SERVICE = 'b1111111-1111-1111-1111-111111111111';
const ANNA = 'a2222222-2222-2222-2222-222222222222';

interface CatalogBody {
  tenant: { name: string; slug: string; timeZone: string };
  services: { id: string; name: string; durationMinutes: number; staff: { id: string; name: string }[] }[];
}

describe('GET /:slug/services', () => {
  it('returns the salon, its zone, and its services with qualified staff', async () => {
    const res = await request(app).get(`/${WIEN_SLUG}/services`);
    expect(res.status, res.text.slice(0, 200)).toBe(200);

    const body = res.body as CatalogBody;
    expect(body.tenant).toEqual({
      name: 'Studio Wien',
      slug: WIEN_SLUG,
      timeZone: 'Europe/Vienna',
    });

    const colour = body.services.find((s) => s.id === COLOR_SERVICE);
    expect(colour).toBeDefined();
    expect(colour!.name).toBe('Full Color');
    expect(colour!.durationMinutes).toBe(150);
    expect(colour!.staff).toEqual([{ id: ANNA, name: 'Anna Huber' }]);
  });

  it('shows each tenant only its own services', async () => {
    // The isolation that matters for this endpoint: RLS, not a WHERE clause.
    // Studio Wien's catalogue must not mention Marina's Cut, and vice versa.
    const wien = await request(app).get(`/${WIEN_SLUG}/services`);
    const marina = await request(app).get(`/${MARINA_SLUG}/services`);

    const wienIds = (wien.body as CatalogBody).services.map((s) => s.id);
    const marinaIds = (marina.body as CatalogBody).services.map((s) => s.id);

    expect(wienIds).toContain(COLOR_SERVICE);
    expect(wienIds).not.toContain(CUT_SERVICE);
    expect(marinaIds).toContain(CUT_SERVICE);
    expect(marinaIds).not.toContain(COLOR_SERVICE);
  });

  it('leaks no staff across tenants', async () => {
    // staff_service gained tenant_id and RLS in the isolate-staff-service
    // migration precisely so a stylist cannot appear under another salon's
    // service. This asserts the result of that.
    const marina = await request(app).get(`/${MARINA_SLUG}/services`);
    const names = (marina.body as CatalogBody).services.flatMap((s) => s.staff.map((m) => m.name));
    expect(names).not.toContain('Anna Huber');
    expect(names).toContain('Marina Lopez');
  });

  it('returns no internal scheduling fields', async () => {
    // Buffers and minimum notice are readable by whiteboard_public because the
    // engine needs them, but they describe how the salon paces its day and
    // have no use on a booking page.
    const res = await request(app).get(`/${WIEN_SLUG}/services`);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/buffer/i);
    expect(raw).not.toMatch(/minimumNotice/i);
    expect(raw).not.toMatch(/tenantId/i);
  });

  it('404s an unknown salon', async () => {
    const res = await request(app).get('/no-such-salon/services');
    expect(res.status).toBe(404);
  });
});
