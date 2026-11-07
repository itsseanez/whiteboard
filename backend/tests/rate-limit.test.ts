// backend/tests/rate-limit.test.ts
//
// Per-IP limits on the public routes. Every request here is refused for its
// body (400) or token (404), so nothing is booked: a refused request still
// counts, which is the point of a limit.

import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const SLUG = 'studio-wien';
const tiny = { limit: 2, windowMs: 60_000 };

function appWithTinyLimits() {
  return createApp({ rateLimits: { read: tiny, book: tiny, manage: tiny } });
}

describe('public rate limits', () => {
  it('answers 429 rate_limited past the limit, with a Retry-After', async () => {
    const app = appWithTinyLimits();
    const from = '198.51.100.1';
    for (let i = 0; i < 2; i++) {
      const res = await request(app).post(`/${SLUG}/appointments`).set('X-Forwarded-For', from).send({});
      expect(res.status).toBe(400);
    }
    const res = await request(app).post(`/${SLUG}/appointments`).set('X-Forwarded-For', from).send({});
    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'rate_limited' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('counts each client address separately, as Caddy forwards it', async () => {
    const app = appWithTinyLimits();
    for (let i = 0; i < 3; i++) {
      await request(app).post(`/${SLUG}/appointments`).set('X-Forwarded-For', '198.51.100.2').send({});
    }
    const other = await request(app).post(`/${SLUG}/appointments`).set('X-Forwarded-For', '198.51.100.3').send({});
    expect(other.status).toBe(400);
  });

  it('keeps booking, the manage page and reads in separate allowances', async () => {
    const app = appWithTinyLimits();
    const from = '198.51.100.4';
    for (let i = 0; i < 3; i++) {
      await request(app).post(`/${SLUG}/appointments`).set('X-Forwarded-For', from).send({});
    }
    const cancel = await request(app)
      .post(`/${SLUG}/appointments/cancel`)
      .set('X-Forwarded-For', from)
      .send({ token: 'A'.repeat(43) });
    expect(cancel.status).toBe(404);
    const services = await request(app).get(`/${SLUG}/services`).set('X-Forwarded-For', from);
    expect(services.status).toBe(200);
  });

  it('limits every route that takes a manage token, together', async () => {
    const app = appWithTinyLimits();
    const from = '198.51.100.5';
    const token = { token: 'A'.repeat(43) };
    await request(app).post(`/${SLUG}/appointments/cancel`).set('X-Forwarded-For', from).send(token);
    await request(app).post('/links/closed').set('X-Forwarded-For', from).send(token);
    for (const path of ['/appointments/reschedule', '/appointments/availability']) {
      const res = await request(app).post(`/${SLUG}${path}`).set('X-Forwarded-For', from).send(token);
      expect(res.status, path).toBe(429);
    }
  });
});
