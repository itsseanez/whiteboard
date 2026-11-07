// @vitest-environment jsdom
import { fakeFetch, json } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Booking from './Booking';

afterEach(cleanup);

// Today in UTC, the organization's zone here, with one free time late tonight.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const slot = { startsAt: `${today}T23:30:00Z`, endsAt: `${today}T23:59:00Z`, staffIds: ['anna'] };

const catalog = () =>
  json(200, {
    tenant: { name: 'Studio Wien', slug: 'studio-wien', timeZone: 'UTC' },
    services: [{ id: 'cut', name: 'Cut', durationMinutes: 29, staff: [{ id: 'anna', name: 'Anna' }] }],
  });
const availability = () => json(200, { timeZone: 'UTC', noQualifiedStaff: false, days: [{ date: today, status: 'open', slots: [slot] }] });

function renderBooking() {
  render(
    <MemoryRouter initialEntries={['/studio-wien']}>
      <Routes>
        <Route path="/:slug" element={<Booking />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Picks today and its one time, and fills in the form. */
async function chooseAndFill() {
  fireEvent.click(await screen.findByRole('button', { name: `${today}, 1 time free` }));
  fireEvent.click(await screen.findByRole('button', { name: /11:30|23:30/ }));
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Jo' } });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jo@example.com' } });
}

describe('Booking', () => {
  it('books a time and shows the link to change or cancel it', async () => {
    const calls = fakeFetch({
      'GET /studio-wien/services': catalog,
      'GET /studio-wien/availability': availability,
      'POST /studio-wien/appointments': () =>
        json(201, { appointmentId: 'a1', staffId: 'anna', startsAt: slot.startsAt, endsAt: slot.endsAt, manageToken: 'tok-1', emailed: true }),
    });
    renderBooking();
    await chooseAndFill();
    fireEvent.click(screen.getByRole('button', { name: 'Book this time' }));

    expect(await screen.findByRole('heading', { name: "You're booked" })).toBeTruthy();
    expect(screen.getByRole('link', { name: /\/studio-wien\/manage\?token=tok-1$/ })).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      serviceId: 'cut',
      staffId: 'anna',
      startsAt: slot.startsAt,
      customer: { name: 'Jo', email: 'jo@example.com' },
    });
  });

  it('says why when someone else took the time first', async () => {
    fakeFetch({
      'GET /studio-wien/services': catalog,
      'GET /studio-wien/availability': availability,
      'POST /studio-wien/appointments': () => json(409, { error: 'slot_taken' }),
    });
    renderBooking();
    await chooseAndFill();
    fireEvent.click(screen.getByRole('button', { name: 'Book this time' }));
    expect(await screen.findByText(/Someone else just took that time/)).toBeTruthy();
  });

  it('tells a rate-limited customer to wait', async () => {
    fakeFetch({
      'GET /studio-wien/services': catalog,
      'GET /studio-wien/availability': availability,
      'POST /studio-wien/appointments': () => json(429, { error: 'rate_limited' }),
    });
    renderBooking();
    await chooseAndFill();
    fireEvent.click(screen.getByRole('button', { name: 'Book this time' }));
    expect(await screen.findByText(/Too many tries from your connection/)).toBeTruthy();
  });

  it('links to the privacy page from the form', async () => {
    fakeFetch({ 'GET /studio-wien/services': catalog, 'GET /studio-wien/availability': availability });
    renderBooking();
    await chooseAndFill();
    expect(screen.getByRole('link', { name: 'Privacy' }).getAttribute('href')).toBe('/privacy');
  });

  it('says so when no organization has this address', async () => {
    fakeFetch({ 'GET /studio-wien/services': () => json(404, { error: 'Not found' }) });
    renderBooking();
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeTruthy();
  });
});
