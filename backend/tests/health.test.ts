import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('GET /api/health', () => {
  it('answers ok with the client address as forwarded by the proxy', async () => {
    const res = await request(createApp()).get('/api/health').set('X-Forwarded-For', '203.0.113.7');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ ok: true, clientIp: '203.0.113.7', outbox: { waiting: expect.any(Number) } });
  });
});
