// @vitest-environment jsdom
import { fakeFetch, json } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Calendar, { CalendarView } from './Calendar';

afterEach(cleanup);

const base = '/tenant/acme';
const today = new Date().toISOString().slice(0, 10); // UTC tenant, so today's UTC date
const at = (hhmm: string) => `${today}T${hhmm}:00Z`;
const allWeek = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, start: '09:00', end: '17:00' }));

const appointment = {
  id: 'a1',
  staffId: 's1',
  serviceId: 'v1',
  serviceName: 'Cut',
  resourceId: null,
  resourceName: null,
  startsAt: at('10:00'),
  endsAt: at('10:45'),
  customer: { name: 'Jo Bloggs', email: 'jo@example.com', phone: '555-0100' },
};

const calendar = {
  timeZone: 'UTC',
  staff: [
    { id: 's1', name: 'Ana', hours: allWeek },
    { id: 's2', name: 'Ben', hours: allWeek },
  ],
  businessHours: allWeek,
  timeOff: [],
  appointments: [appointment],
};

const cut = {
  id: 'v1',
  name: 'Cut',
  durationMinutes: 45,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  minimumNoticeMinutes: 0,
  staffIds: ['s1'],
  resourceIds: [],
};

const explain = {
  timeZone: 'UTC',
  noQualifiedStaff: false,
  days: [
    {
      date: today,
      status: 'open',
      slots: [{ startsAt: at('09:00'), endsAt: at('09:45'), staffIds: ['s1'], resourceIds: [] }],
      excluded: [
        {
          startsAt: at('10:00'),
          reason: [{ reason: 'busy', staffId: 's1', busyInterval: { startsAt: at('10:00'), endsAt: at('10:45'), appointmentId: 'a1' } }],
        },
      ],
    },
  ],
};

function setup(extra: Record<string, () => Response> = {}) {
  return fakeFetch({
    [`GET ${base}`]: () => json(200, { tenant: { name: 'Acme', slug: 'acme', timezone: 'UTC' }, membership: { role: 'owner' } }),
    [`GET ${base}/services`]: () => json(200, [cut]),
    [`GET ${base}/calendar`]: () => json(200, calendar),
    [`GET ${base}/availability/explain`]: () => json(200, explain),
    ...extra,
  });
}

function renderCalendar() {
  render(
    <MemoryRouter initialEntries={['/manage/acme?tab=calendar']}>
      <Routes>
        <Route path="/manage/:slug" element={<CalendarView slug="acme" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Calendar', () => {
  it("shows the day's appointments in staff columns, with customer details on click", async () => {
    setup();
    renderCalendar();
    fireEvent.click(await screen.findByRole('button', { name: /Cut\s*Jo Bloggs/ }));
    expect(screen.getByRole('link', { name: 'jo@example.com' }).getAttribute('href')).toBe('mailto:jo@example.com');
  });

  it('cancels only after a second click', async () => {
    const calls = setup({ [`POST ${base}/appointments/a1/cancel`]: () => json(200, { appointmentId: 'a1', status: 'CANCELLED', cancelled: true }) });
    renderCalendar();
    fireEvent.click(await screen.findByRole('button', { name: /Cut\s*Jo Bloggs/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel appointment' }));
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));
    await waitFor(() => expect(calls.some((c) => c.path === `${base}/appointments/a1/cancel`)).toBe(true));
  });

  it('explains why a time is not bookable once a service is picked', async () => {
    setup();
    renderCalendar();
    fireEvent.change(await screen.findByLabelText('Check availability for'), { target: { value: 'v1' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Why not Ana at / }));
    expect(await screen.findByText(/^Ana is with a customer \(Cut, /)).toBeTruthy();
  });

  it('books a bookable time for a customer', async () => {
    const calls = setup({ [`POST ${base}/appointments`]: () => json(201, { appointmentId: 'a2', staffId: 's1', startsAt: at('09:00'), endsAt: at('09:45') }) });
    renderCalendar();
    fireEvent.change(await screen.findByLabelText('Check availability for'), { target: { value: 'v1' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Book Ana at / }));
    fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: 'New Person' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      serviceId: 'v1',
      staffId: 's1',
      startsAt: at('09:00'),
      customer: { name: 'New Person', email: 'new@example.com' },
    });
  });

  it('moves an appointment to a free time', async () => {
    const calls = setup({ [`POST ${base}/appointments/a1/reschedule`]: () => json(200, { appointmentId: 'a1', staffId: 's1', startsAt: at('09:00'), endsAt: at('09:45') }) });
    renderCalendar();
    fireEvent.click(await screen.findByRole('button', { name: /Cut\s*Jo Bloggs/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    fireEvent.click(await screen.findByRole('button', { name: /^0?9:00( AM)?$/ }));
    await waitFor(() => expect(calls.some((c) => c.path === `${base}/appointments/a1/reschedule`)).toBe(true));
    expect(calls.find((c) => c.path.endsWith('/reschedule'))?.body).toEqual({ startsAt: at('09:00') });
  });

  it('lists the week and opens a day from it', async () => {
    setup();
    renderCalendar();
    fireEvent.click(await screen.findByRole('button', { name: 'Week' }));
    expect(await screen.findByText('Jo Bloggs · Ana')).toBeTruthy();
    expect(screen.getAllByText('Nothing booked').length).toBe(6);
  });

  it('tells a staff member they cannot see it', async () => {
    setup({ [`GET ${base}/calendar`]: () => json(403, { error: 'managers_only' }) });
    renderCalendar();
    expect(await screen.findByText(/Only owners and managers can see this calendar/)).toBeTruthy();
  });

  it('sends the old calendar address to the Calendar tab of setup', async () => {
    setup();
    render(
      <MemoryRouter initialEntries={['/manage/acme/calendar']}>
        <Routes>
          <Route path="/manage/:slug/calendar" element={<Calendar />} />
          <Route path="/manage/:slug" element={<p>setup page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('setup page')).toBeTruthy();
  });
});
