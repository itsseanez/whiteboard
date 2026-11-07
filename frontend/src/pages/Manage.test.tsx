// @vitest-environment jsdom
import { fakeFetch, json } from '../test/fake-api'; // first: see the file
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Manage from './Manage';

afterEach(cleanup);

function renderManage() {
  render(
    <MemoryRouter initialEntries={['/studio-wien/manage?token=tok-1']}>
      <Routes>
        <Route path="/:slug/manage" element={<Manage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Manage', () => {
  it('says a closed organization is closed permanently, even if its address now belongs to someone else', async () => {
    const calls = fakeFetch({
      'POST /links/closed': () => json(200, { name: 'Studio Wien', closedAt: '2026-11-01T00:00:00Z' }),
      'GET /studio-wien/services': () =>
        json(200, { tenant: { name: 'Someone New', timeZone: 'UTC' }, services: [], staff: [] }),
    });
    renderManage();
    expect(await screen.findByRole('heading', { name: 'This organization is closed permanently' })).toBeTruthy();
    expect(screen.getByText(/Studio Wien has closed its booking page/)).toBeTruthy();
    expect(screen.queryByText(/Someone New/)).toBeNull();
    expect(calls.find((c) => c.path === '/links/closed')?.body).toEqual({ token: 'tok-1' });
  });

  it('shows the appointment as usual when the link is not a closed one', async () => {
    fakeFetch({
      'POST /links/closed': () => json(404, { error: 'not_closed' }),
      'GET /studio-wien/services': () =>
        json(200, {
          tenant: { name: 'Studio Wien', timeZone: 'Europe/Vienna' },
          services: [{ id: 's1', name: 'Cut', durationMinutes: 45 }],
          staff: [],
        }),
    });
    renderManage();
    expect(await screen.findByRole('heading', { name: /Your\s+appointment/ })).toBeTruthy();
  });
});
