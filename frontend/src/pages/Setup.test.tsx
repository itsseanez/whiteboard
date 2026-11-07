// @vitest-environment jsdom
import { fakeFetch, json } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Setup from './Setup';

afterEach(cleanup);

const base = '/tenant/acme';
const ana = { id: 's1', name: 'Ana', hours: [{ weekday: 1, start: '09:00', end: '12:00' }] };
const wash = { id: 'r1', name: 'Wash station' };
const color = {
  id: 'v1',
  name: 'Color',
  durationMinutes: 90,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15,
  minimumNoticeMinutes: 60,
  staffIds: ['s1'],
  resourceIds: ['r1'],
};

const context = (role: string) => () =>
  json(200, { tenant: { name: 'Acme', slug: 'acme', timezone: 'UTC' }, membership: { role } });
const nobody = () => json(200, { members: [], invitations: [] });

function ready(extra: Record<string, () => Response> = {}) {
  return fakeFetch({
    [`GET ${base}`]: context('owner'),
    [`GET ${base}/people`]: nobody,
    [`GET ${base}/business-hours`]: () => json(200, { hours: [] }),
    [`GET ${base}/resources`]: () => json(200, [wash]),
    [`GET ${base}/staff`]: () => json(200, [ana]),
    [`GET ${base}/services`]: () => json(200, [color]),
    ...extra,
  });
}

function renderSetup(tab?: 'calendar' | 'hours' | 'staff' | 'accounts' | 'services') {
  render(
    <MemoryRouter initialEntries={[tab ? `/manage/acme?tab=${tab}` : '/manage/acme']}>
      <Routes>
        <Route path="/manage/:slug" element={<Setup />} />
        <Route path="/account" element={<p>account page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Setup', () => {
  it('sends a staff member to their own week', async () => {
    const refused = () => json(403, { error: 'managers_only' });
    fakeFetch({
      [`GET ${base}`]: context('member'),
      [`GET ${base}/people`]: refused,
      [`GET ${base}/business-hours`]: refused,
      [`GET ${base}/resources`]: refused,
      [`GET ${base}/staff`]: refused,
      [`GET ${base}/services`]: refused,
    });
    renderSetup();
    expect(await screen.findByText(/Only owners and managers can set up/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See your week' }).getAttribute('href')).toBe('/manage/acme/me');
  });

  it("doesn't reveal whether someone else's organization exists", async () => {
    fakeFetch({ [`GET ${base}/business-hours`]: () => json(404, { error: 'Tenant not found' }) });
    renderSetup();
    expect(await screen.findByText(/don't have an organization at this address/)).toBeTruthy();
  });

  it('shows what is already set up, a tab at a time', async () => {
    ready();
    renderSetup('hours');
    expect(await screen.findByRole('button', { name: 'Save opening hours' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save Ana' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Staff' }));
    expect(screen.getByRole('button', { name: 'Save Ana' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Services and resources' }));
    expect(screen.getByText('Wash station', { selector: 'li span' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save Color' })).toBeTruthy();
  });

  it('opens on the calendar, with the tabs in a column', async () => {
    ready();
    renderSetup();
    expect((await screen.findByRole('tab', { name: 'Calendar' })).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('vertical');
  });

  it('keeps unsaved edits across tabs and marks the tab holding them', async () => {
    ready();
    renderSetup('staff');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Monday 09:00–12:00' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Opening hours' }));
    expect(screen.getByRole('tab', { name: /^Staff\s*\(unsaved changes\)$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^Staff/ }));
    expect(screen.queryByRole('button', { name: 'Remove Monday 09:00–12:00' })).toBeNull();
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('adds a staff member and reloads', async () => {
    const calls = ready({ [`POST ${base}/staff`]: () => json(201, { id: 's2', name: 'Ben', hours: [] }) });
    renderSetup('staff');
    fireEvent.change(await screen.findByLabelText('New staff member'), { target: { value: ' Ben ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add staff member' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === `${base}/staff`)).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Ben' });
  });

  it('saves opening hours as one week and shows the server refusing an overlap', async () => {
    const calls = ready({
      [`PUT ${base}/business-hours`]: () => json(400, { error: '09:00–17:00 and 12:00–18:00 overlap' }),
    });
    renderSetup('hours');
    await screen.findByRole('button', { name: 'Save opening hours' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add hours' })[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Save opening hours' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/overlap/);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toEqual({ hours: [{ weekday: 1, start: '09:00', end: '17:00' }] });
  });

  it('sends a midnight end as 00:00', async () => {
    const calls = ready({ [`PUT ${base}/business-hours`]: () => json(200, { hours: [] }) });
    renderSetup('hours');
    await screen.findByRole('button', { name: 'Save opening hours' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add hours' })[0]!);
    fireEvent.change(screen.getAllByLabelText('Monday end')[0]!, { target: { value: '00:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save opening hours' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ hours: [{ weekday: 1, start: '09:00', end: '00:00' }] });
  });

  it('removes a staff member after a second click, and explains a refusal', async () => {
    const calls = ready({
      [`DELETE ${base}/staff/s1`]: () => json(409, { error: 'has_future_appointments', count: 2 }),
    });
    renderSetup('staff');
    await screen.findByRole('button', { name: 'Save Ana' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ana' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Ana' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/upcoming appointments/);
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe(`${base}/staff/s1`);
  });

  it('removes a service and reloads', async () => {
    const calls = ready({ [`DELETE ${base}/services/v1`]: () => new Response(null, { status: 204 }) });
    renderSetup('services');
    await screen.findByRole('button', { name: 'Save Color' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Color' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Color' }));
    await waitFor(() => expect(calls.filter((c) => c.path === `${base}/services`).length).toBe(2));
  });

  it("explains why a service's only resource can't be removed", async () => {
    ready({ [`DELETE ${base}/resources/r1`]: () => json(409, { error: 'only_resource_for_service', services: ['Color'] }) });
    renderSetup('services');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Wash station' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove Wash station' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/only resource a service can use/);
  });

  it("removes one range from a staff member's week with the trash button", async () => {
    const calls = ready({ [`PUT ${base}/staff/s1/hours`]: () => json(200, { hours: [] }) });
    renderSetup('staff');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Monday 09:00–12:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Ana' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ hours: [] });
  });

  it('marks an edited card as unsaved until it is saved', async () => {
    ready({ [`PUT ${base}/staff/s1/hours`]: () => json(200, { hours: [] }) });
    renderSetup('staff');
    await screen.findByRole('button', { name: 'Save Ana' });
    expect(screen.queryByText('Unsaved changes')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Monday 09:00–12:00' }));
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save Ana' }));
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
  });

  it('asks the browser to confirm leaving while edits are unsaved', async () => {
    ready({ [`PUT ${base}/business-hours`]: () => json(200, { hours: [{ weekday: 1, start: '09:00', end: '17:00' }] }) });
    renderSetup('hours');
    await screen.findByRole('button', { name: 'Save opening hours' });
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);

    fireEvent.click(screen.getAllByRole('button', { name: 'Add hours' })[0]!);
    expect(leave()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Save opening hours' }));
    await waitFor(() => expect(leave()).toBe(false));
  });

  it('sends the ticked staff and resources with a new service', async () => {
    const calls = ready({ [`POST ${base}/services`]: () => json(201, { ...color, id: 'v2', name: 'Cut' }) });
    renderSetup('services');
    const form = (await screen.findByText('New service')).closest('form')!;
    const name = form.querySelector('input[type="text"]') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Cut' } });
    const boxes = form.querySelectorAll('input[type="checkbox"]');
    fireEvent.click(boxes[0]!); // Ana
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({
      name: 'Cut',
      staffIds: ['s1'],
      resourceIds: [],
    });
  });

  describe('sign-ins', () => {
    it("invites a staff member from their card", async () => {
      const calls = ready({ [`POST ${base}/invitations`]: () => json(201, { invitationId: 'i1' }) });
      renderSetup('staff');
      fireEvent.change(await screen.findByLabelText("Ana's email, to sign in"), { target: { value: 'ana@acme.example' } });
      fireEvent.click(screen.getByRole('button', { name: 'Invite Ana' }));
      await waitFor(() => expect(calls.some((c) => c.path === `${base}/invitations`)).toBe(true));
      expect(calls.find((c) => c.path === `${base}/invitations`)?.body).toEqual({
        email: 'ana@acme.example',
        role: 'staff',
        staffId: 's1',
      });
    });

    it("says who a staff member signs in as", async () => {
      ready({
        [`GET ${base}/people`]: () =>
          json(200, {
            members: [{ memberId: 'm1', userId: 'u1', name: 'Ana', email: 'ana@acme.example', role: 'member', staffId: 's1' }],
            invitations: [],
          }),
      });
      renderSetup('staff');
      expect(await screen.findByText('Signs in as ana@acme.example to see their own week.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Invite Ana' })).toBeNull();
    });

    it('lets an owner invite a manager, and a manager not', async () => {
      ready();
      renderSetup('accounts');
      expect(await screen.findByRole('button', { name: 'Invite manager' })).toBeTruthy();
      cleanup();
      ready({ [`GET ${base}`]: context('admin') });
      renderSetup('accounts');
      await screen.findByRole('tab', { name: 'Accounts' });
      expect(screen.queryByRole('button', { name: 'Invite manager' })).toBeNull();
    });
  });

  describe('connecting other apps', () => {
    it('is tucked into Accounts for owners, and opens on request', async () => {
      ready({ [`GET ${base}/webhooks`]: () => json(200, { webhooks: [] }) });
      renderSetup('accounts');
      expect(await screen.findByRole('heading', { name: 'Advanced: connect other apps' })).toBeTruthy();
      expect(screen.queryByRole('tab', { name: 'Webhooks' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Set up a connection…' }));
      expect(await screen.findByText('No connections yet.')).toBeTruthy();
    });

    it('is not shown to a manager', async () => {
      ready({ [`GET ${base}`]: context('admin') });
      renderSetup('accounts');
      await screen.findByRole('heading', { name: 'Accounts' });
      expect(screen.queryByRole('heading', { name: 'Advanced: connect other apps' })).toBeNull();
    });
  });

  describe('closing the organization', () => {
    it('lets an owner close it once the address is typed back', async () => {
      const calls = ready({ [`DELETE ${base}`]: () => json(200, { cancelled: 2, emailed: 2 }) });
      renderSetup('accounts');
      fireEvent.click(await screen.findByRole('button', { name: 'Close organization…' }));
      const confirm = screen.getByRole('button', { name: 'Close Acme' }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText('Type acme to confirm'), { target: { value: 'acme' } });
      expect(confirm.disabled).toBe(false);
      fireEvent.click(confirm);
      expect(await screen.findByText('account page')).toBeTruthy();
      expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({ confirm: 'acme' });
    });

    it('is not offered to a manager', async () => {
      ready({ [`GET ${base}`]: context('admin') });
      renderSetup('accounts');
      await screen.findByRole('heading', { name: 'Accounts' });
      expect(screen.queryByRole('button', { name: 'Close organization…' })).toBeNull();
    });
  });
});
