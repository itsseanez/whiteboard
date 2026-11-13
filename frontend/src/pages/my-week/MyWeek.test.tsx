// @vitest-environment jsdom
import { fakeFetch, json } from '@/test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

function renderPage(at = '/manage/acme/me') {
  render(
    <MemoryRouter initialEntries={[at]}>
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

  it('says which days are closed and which they are not working', async () => {
    const weekdays = [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '09:00', end: '17:00' }));
    fakeFetch({
      [`GET ${base}`]: context,
      [`GET ${base}/me/week`]: () =>
        json(200, {
          timeZone: 'UTC',
          staff: [{ id: 's1', name: 'Ana', archived: false, hours: [{ weekday: 1, start: '09:00', end: '17:00' }] }],
          businessHours: weekdays,
          timeOff: [],
          appointments: [],
        }),
    });
    renderPage();
    await screen.findByRole('heading', { name: "Ana's week" });
    const day = (name: string) => screen.getByRole('heading', { name: new RegExp(`^${name} `) }).closest('li')!.textContent;
    expect(day('Monday')).toContain('Nothing booked.');
    expect(day('Tuesday')).toContain('Not working');
    expect(day('Tuesday')).not.toContain('Nothing booked.');
    expect(day('Sunday')).toContain('Closed');
    expect(day('Sunday')).not.toContain('Not working');
  });

  it('shows their hours read-only, in their own tab', async () => {
    const calls = fakeFetch({ [`GET ${base}`]: context, [`GET ${base}/me/week`]: week, [`GET ${base}/time-off`]: () => json(200, { timeOff: [] }) });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Working hours' }));
    const panel = screen.getByRole('tabpanel', { name: 'Working hours' });
    expect(panel.textContent).toContain('Monday09:00–17:00');
    expect(panel.textContent).toContain('TuesdayNot working');
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(panel.querySelector('input')).toBeNull();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('opens the tab named in the address', async () => {
    fakeFetch({ [`GET ${base}`]: context, [`GET ${base}/me/week`]: week, [`GET ${base}/time-off`]: () => json(200, { timeOff: [] }) });
    renderPage('/manage/acme/me?tab=time-off');
    expect((await screen.findByRole('tab', { name: 'Time off' })).getAttribute('aria-selected')).toBe('true');
  });

  it('explains an account with no staff profile', async () => {
    fakeFetch({ [`GET ${base}`]: context, [`GET ${base}/me/week`]: () => json(404, { error: 'not_staff' }) });
    renderPage();
    expect(await screen.findByText(/isn't linked to a staff profile/)).toBeTruthy();
  });
});
