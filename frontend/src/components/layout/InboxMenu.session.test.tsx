// @vitest-environment jsdom
// Its own file: a signed-in session, which the auth client keeps at module level.
import { fakeFetch, json, replies } from '@/test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import TopBar from './TopBar';

afterEach(cleanup);

const booking = {
  id: 'n1', kind: 'appointment_booked', category: 'appointments', link: '/manage/wien?tab=calendar', read: false,
  createdAt: new Date().toISOString(),
  data: { organization: 'Studio Wien', timeZone: 'UTC', service: 'Cut', customer: 'Cleo', staff: 'Ana', startsAt: '2031-02-03T09:00:00Z', byCustomer: true },
};

function renderBar() {
  render(
    <MemoryRouter initialEntries={['/account']}>
      <TopBar />
      <Routes>
        <Route path="/account" element={<p>account page</p>} />
        <Route path="/manage/:slug" element={<p>calendar page</p>} />
        <Route path="/account/inbox" element={<p>inbox page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the inbox in the top bar', () => {
  it('shows the unread count, and opens a message, marking it read', async () => {
    const calls = fakeFetch({
      'GET /api/auth/get-session': replies.session,
      'GET /me/notifications': () => json(200, { items: [booking], total: 12, unread: 12, page: 1, pageSize: 5 }),
      'POST /me/notifications/n1/read': () => new Response(null, { status: 204 }),
    });
    renderBar();
    const icon = await screen.findByRole('button', { name: 'Inbox, 12 unread' });
    expect(icon.textContent).toBe('12');
    fireEvent.click(icon);
    fireEvent.click(screen.getByRole('button', { name: /New booking: Cut with Cleo/ }));
    expect(await screen.findByText('calendar page')).toBeTruthy();
    expect(calls.some((c) => c.method === 'POST' && c.path === '/me/notifications/n1/read')).toBe(true);
  });

  it('marks everything read, and links to the full inbox', async () => {
    const calls = fakeFetch({
      'GET /api/auth/get-session': replies.session,
      'GET /me/notifications': () => json(200, { items: [booking], total: 1, unread: 1, page: 1, pageSize: 5 }),
      'POST /me/notifications/read-all': () => json(200, { marked: 1 }),
    });
    renderBar();
    fireEvent.click(await screen.findByRole('button', { name: 'Inbox, 1 unread' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }));
    await waitFor(() => expect(calls.some((c) => c.path === '/me/notifications/read-all')).toBe(true));
    // Asking again after marking: the bar refreshes itself.
    await waitFor(() => expect(calls.filter((c) => c.path === '/me/notifications').length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole('link', { name: 'See all messages' }));
    expect(await screen.findByText('inbox page')).toBeTruthy();
  });
});
