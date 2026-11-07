// @vitest-environment jsdom
import { fakeFetch, json } from '@/test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import TimeOff from './TimeOff';

afterEach(cleanup);

const ENTRY = {
  id: 't1',
  staffId: 'ben',
  staffName: 'Ben',
  startsAt: '2031-12-23T23:00:00Z',
  endsAt: '2031-12-26T23:00:00Z',
  reason: 'family',
  status: 'approved',
};

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('TimeOff', () => {
  it("lists the organization's time off and adds for the staff member picked", async () => {
    const calls = fakeFetch({
      'GET /tenant/wien/time-off': () => json(200, { timeZone: 'Europe/Vienna', timeOff: [ENTRY] }),
      'POST /tenant/wien/time-off': () => json(201, { id: 't2', status: 'approved', overlappingAppointments: 2 }),
    });
    render(
      <TimeOff
        slug="wien"
        timeZone="Europe/Vienna"
        staff={[
          { id: 'anna', name: 'Anna' },
          { id: 'ben', name: 'Ben' },
        ]}
      />,
    );
    const list = await screen.findByRole('list', { name: 'Upcoming time off' });
    expect(within(list).getByText(/Ben · family/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Who'), { target: { value: 'ben' } });
    fill('From', '2032-01-05');
    fill('From time (optional)', '09:00');
    fill('Until time (optional)', '12:00');
    fireEvent.click(screen.getByRole('button', { name: 'Add time off' }));

    expect(await screen.findByText(/2 booked appointments fall in this time/)).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      staffId: 'ben',
      startDate: '2032-01-05',
      startTime: '09:00',
      endTime: '12:00',
    });
  });

  it("sends a staff member's own as a request, and lets them withdraw it", async () => {
    const calls = fakeFetch({
      'GET /tenant/wien/time-off': () =>
        json(200, { timeZone: 'Europe/Vienna', timeOff: [{ ...ENTRY, staffId: 'me', staffName: 'Me', status: 'pending' }] }),
      'POST /tenant/wien/time-off': () => json(201, { id: 't2', status: 'pending', overlappingAppointments: 0 }),
      'DELETE /tenant/wien/time-off/t1': () => new Response(null, { status: 204 }),
    });
    render(<TimeOff slug="wien" timeZone="Europe/Vienna" />);
    await screen.findByRole('list', { name: 'Upcoming time off' });
    expect(screen.queryByLabelText('Who')).toBeNull();
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();

    fill('From', '2032-02-01');
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/An owner or manager will approve or decline it/)).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ startDate: '2032-02-01' });

    fireEvent.click(screen.getByRole('button', { name: /Withdraw request/ }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await screen.findByRole('list', { name: 'Upcoming time off' });
    expect(calls.some((c) => c.method === 'DELETE' && c.path === '/tenant/wien/time-off/t1')).toBe(true);
  });

  it("doesn't let staff remove time off once it's approved", async () => {
    fakeFetch({ 'GET /tenant/wien/time-off': () => json(200, { timeZone: 'Europe/Vienna', timeOff: [ENTRY] }) });
    render(<TimeOff slug="wien" timeZone="Europe/Vienna" />);
    await screen.findByRole('list', { name: 'Upcoming time off' });
    expect(screen.queryByRole('button', { name: /Remove time off|Withdraw request/ })).toBeNull();
  });

  it('lets owners and managers approve a request, and says what it overlaps', async () => {
    const calls = fakeFetch({
      'GET /tenant/wien/time-off': () => json(200, { timeZone: 'Europe/Vienna', timeOff: [{ ...ENTRY, status: 'pending' }] }),
      'POST /tenant/wien/time-off/t1/approve': () => json(200, { status: 'approved', overlappingAppointments: 1 }),
    });
    render(<TimeOff slug="wien" timeZone="Europe/Vienna" staff={[{ id: 'ben', name: 'Ben' }]} />);
    expect(await screen.findByText('1 request waiting for a decision.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Approved. 1 booked appointment falls in this time/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/tenant/wien/time-off/t1/approve')).toBe(true);
  });
});
