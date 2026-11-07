// @vitest-environment jsdom
// Its own file: it needs a signed-in user, which the auth client keeps at
// module level for the rest of a file.
import { fakeFetch, json, replies } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Setup from './Setup';

afterEach(cleanup);

const base = '/tenant/acme';
// replies.session is user u2; here u2 is an owner.
const people = {
  members: [
    { memberId: 'm-self', userId: 'u2', name: 'Test Owner', email: 'owner@example.com', role: 'owner', staffId: null },
    { memberId: 'm-mgr', userId: 'u3', name: 'Mia', email: 'mia@acme.example', role: 'admin', staffId: null },
  ],
  invitations: [],
};

function ready(role: string, extra: Record<string, () => Response> = {}) {
  return fakeFetch({
    'GET /api/auth/get-session': replies.session,
    [`GET ${base}`]: () => json(200, { tenant: { name: 'Acme', slug: 'acme', timezone: 'UTC' }, membership: { role } }),
    [`GET ${base}/people`]: () => json(200, people),
    [`GET ${base}/business-hours`]: () => json(200, { hours: [] }),
    [`GET ${base}/resources`]: () => json(200, []),
    [`GET ${base}/staff`]: () => json(200, []),
    [`GET ${base}/services`]: () => json(200, []),
    ...extra,
  });
}

function renderAccounts() {
  render(
    <MemoryRouter initialEntries={['/manage/acme?tab=accounts']}>
      <Routes>
        <Route path="/manage/:slug" element={<Setup />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Setup, changing roles', () => {
  it('lets an owner make a manager an owner straight away', async () => {
    const calls = ready('owner', { [`PATCH ${base}/members/m-mgr`]: () => new Response(null, { status: 204 }) });
    renderAccounts();
    fireEvent.change(await screen.findByLabelText("Mia's role"), { target: { value: 'owner' } });
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ role: 'owner' });
  });

  it('asks before an owner steps themselves down, and explains a refusal', async () => {
    const calls = ready('owner', { [`PATCH ${base}/members/m-self`]: () => json(409, { error: 'last_owner' }) });
    renderAccounts();
    await screen.findByLabelText("Mia's role");
    fireEvent.change(screen.getByLabelText("Test Owner's role"), { target: { value: 'manager' } });
    expect(await screen.findByText("You'll no longer be an owner.")).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Yes, change my role' }));
    expect(await screen.findByText(/There has to be at least one owner/)).toBeTruthy();
  });

  it('shows roles as text to a manager', async () => {
    ready('admin');
    renderAccounts();
    expect(await screen.findByText('Manager')).toBeTruthy();
    expect(screen.queryByLabelText("Mia's role")).toBeNull();
  });
});
