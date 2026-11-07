// @vitest-environment jsdom
import { fakeFetch, json } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it("asks for times with the token, so the server picks the appointment's own service and stylist", async () => {
    const calls = fakeFetch({
      'POST /links/closed': () => json(404, { error: 'not_closed' }),
      'GET /studio-wien/services': () =>
        json(200, {
          tenant: { name: 'Studio Wien', timeZone: 'UTC' },
          services: [{ id: 'first-service', name: 'Cut', durationMinutes: 45 }],
          staff: [],
        }),
      'POST /studio-wien/appointments/availability': () =>
        json(200, {
          timeZone: 'UTC',
          noQualifiedStaff: false,
          days: [{ date: '2026-11-17', status: 'open', slots: [] }],
          staffId: 'anna',
          staff: [{ id: 'anna', name: 'Anna' }],
        }),
    });
    renderManage();
    fireEvent.click(await screen.findByRole('button', { name: 'Move it' }));
    await screen.findByText(/Nothing free on this day|Closed on this day/);

    const asked = calls.find((c) => c.path === '/studio-wien/appointments/availability');
    expect(asked?.method).toBe('POST');
    expect(asked?.body).toMatchObject({ token: 'tok-1' });
    expect(JSON.stringify(asked?.body)).not.toContain('first-service');
    expect(calls.some((c) => c.path === '/studio-wien/availability')).toBe(false);
  });

  it('says so up front when the appointment can no longer be moved', async () => {
    fakeFetch({
      'POST /links/closed': () => json(404, { error: 'not_closed' }),
      'GET /studio-wien/services': () =>
        json(200, { tenant: { name: 'Studio Wien', timeZone: 'UTC' }, services: [], staff: [] }),
      'POST /studio-wien/appointments/availability': () => json(409, { error: 'not_booked' }),
    });
    renderManage();
    fireEvent.click(await screen.findByRole('button', { name: 'Move it' }));
    expect(await screen.findByText(/already cancelled or finished/)).toBeTruthy();
  });

  it('tells a rate-limited customer to wait rather than that something broke', async () => {
    fakeFetch({
      'POST /links/closed': () => json(404, { error: 'not_closed' }),
      'GET /studio-wien/services': () =>
        json(200, { tenant: { name: 'Studio Wien', timeZone: 'UTC' }, services: [], staff: [] }),
      'POST /studio-wien/appointments/cancel': () => json(429, { error: 'rate_limited' }),
    });
    renderManage();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel it' }));
    expect(await screen.findByText(/Too many tries from your connection/)).toBeTruthy();
  });

  it('offers another stylist, and moves to them', async () => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const calls = fakeFetch({
      'POST /links/closed': () => json(404, { error: 'not_closed' }),
      'GET /studio-wien/services': () => json(200, { tenant: { name: 'Studio Wien', timeZone: 'UTC' }, services: [], staff: [] }),
      'POST /studio-wien/appointments/availability': () =>
        json(200, {
          timeZone: 'UTC',
          noQualifiedStaff: false,
          days: [{ date: day, status: 'open', slots: [{ startsAt: `${day}T23:00:00Z`, endsAt: `${day}T23:30:00Z`, staffIds: ['bea'] }] }],
          staffId: 'anna',
          staff: [{ id: 'anna', name: 'Anna' }, { id: 'bea', name: 'Bea' }],
        }),
      'POST /studio-wien/appointments/reschedule': () =>
        json(200, { appointmentId: 'a1', staffId: 'bea', startsAt: `${day}T23:00:00Z`, endsAt: `${day}T23:30:00Z` }),
    });
    renderManage();
    fireEvent.click(await screen.findByRole('button', { name: 'Move it' }));
    fireEvent.change(await screen.findByLabelText('With'), { target: { value: 'bea' } });
    await waitFor(() => expect(calls.filter((c) => c.path.endsWith('/availability')).at(-1)?.body).toMatchObject({ staffId: 'bea' }));
    fireEvent.click(await screen.findByRole('button', { name: /until/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to this time' }));
    expect(await screen.findByRole('heading', { name: 'Moved' })).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith('/reschedule'))?.body).toMatchObject({ staffId: 'bea' });
  });
});
