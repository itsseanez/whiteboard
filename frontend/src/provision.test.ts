import { afterEach, describe, expect, it, vi } from 'vitest';
import { provisionOrganization } from './provision';
import { json } from './test/fake-api';

const input = { name: 'Studio', slug: 'studio-x', timezone: 'Europe/Vienna' };

function reply(response: Response | Error) {
  const fetchMock = vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response)));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('provisionOrganization', () => {
  it('posts to /me/tenants and returns the slug on 201', async () => {
    const fetchMock = reply(json(201, { slug: 'studio-x' }));
    expect(await provisionOrganization(input)).toEqual({ ok: true, slug: 'studio-x' });
    expect(fetchMock).toHaveBeenCalledWith('/me/tenants', expect.objectContaining({ method: 'POST' }));
  });

  it('treats 200 (already provisioned) as success', async () => {
    reply(json(200, { slug: 'studio-x' }));
    expect(await provisionOrganization(input)).toEqual({ ok: true, slug: 'studio-x' });
  });

  it('maps 409 slug_taken', async () => {
    reply(json(409, { error: 'slug_taken' }));
    expect(await provisionOrganization(input)).toEqual({ ok: false, reason: 'slug_taken' });
  });

  it('maps a validation error to failed with a sentence', async () => {
    reply(json(400, { error: 'invalid_timezone' }));
    expect(await provisionOrganization(input)).toEqual({
      ok: false,
      reason: 'failed',
      detail: 'The time zone was not recognised.',
    });
  });

  it('maps a server failure to failed without detail', async () => {
    reply(json(500, { error: 'provision_failed', detail: 'organization_not_created' }));
    expect(await provisionOrganization(input)).toEqual({ ok: false, reason: 'failed' });
  });

  it('rethrows network failures', async () => {
    reply(new TypeError('Failed to fetch'));
    await expect(provisionOrganization(input)).rejects.toThrow('Failed to fetch');
  });
});
