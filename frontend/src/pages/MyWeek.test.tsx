// @vitest-environment jsdom
import { fakeFetch, json } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import MyWeek from './MyWeek';

afterEach(cleanup);

const base = '/tenant/acme';
const context = () => json(200, { tenant: { name: 'Acme', slug: 'acme', timezone: 'UTC' }, membership: { role: 'member' } });
const week = () =>
  json(200, {
    timeZone: 'UTC',
    staff: [{ id: 's1', name: 'Ana', archived: false, hours: [{ weekday: 1, start: '09:00', end: '17:00' }] }],
    businessHours: [],
    timeOff: [],
    appointments: [
      {
        id: 'a1',
        staffId: 's1',
        serviceId: 'v1',
        serviceName: 'Cut',
        resourceId: null,
        resourceName: null,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        customer: { name: 'Carla', email: 'carla@example.com', phone: null },
      },
    ],
  });

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/manage/acme/me']}>
      <Routes>
        <Route path="/manage/:slug/me" element={<MyWeek />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('MyWeek', () => {
  it("shows the staff member's own appointments this week", async () => {
    const calls = fakeFetch({ [`GET ${base}`]: context, [`GET ${base}/me/week`]: week });
    renderPage();
    expect(await screen.findByRole('heading', { name: "Ana's week" })).toBeTruthy();
    expect(screen.getByText(/Cut for Carla/)).toBeTruthy();
    expect(screen.getByText('carla@example.com')).toBeTruthy();
    const query = new URLSearchParams(calls.find((c) => c.path === `${base}/me/week`)!.query);
    expect(query.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('saves their own hours', async () => {
    const calls = fakeFetch({
      [`GET ${base}`]: context,
      [`GET ${base}/me/week`]: week,
      [`PUT ${base}/me/hours`]: () => json(200, { hours: [] }),
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Save hours' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ hours: [{ weekday: 1, start: '09:00', end: '17:00' }] });
    expect(await screen.findByText('Saved.')).toBeTruthy();
  });

  it('explains an account with no staff profile', async () => {
    fakeFetch({ [`GET ${base}`]: context, [`GET ${base}/me/week`]: () => json(404, { error: 'not_staff' }) });
    renderPage();
    expect(await screen.findByText(/isn't linked to a staff profile/)).toBeTruthy();
  });
});
