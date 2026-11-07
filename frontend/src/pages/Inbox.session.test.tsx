// @vitest-environment jsdom
// Its own file: a signed-in session, which the auth client keeps at module level.
import { fakeFetch, json, replies } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Inbox from './Inbox';

afterEach(cleanup);

const item = (n: number) => ({
  id: `n${n}`, kind: 'member_joined', category: 'team', link: '/manage/wien?tab=accounts', read: n > 2,
  createdAt: new Date().toISOString(), data: { organization: 'Studio Wien', person: `Person ${n}`, role: 'member' },
});

function renderInbox(path = '/account/inbox') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/account/inbox" element={<Inbox />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the inbox page', () => {
  it('pages through messages and filters them, asking the server each time', async () => {
    const calls = fakeFetch({
      'GET /api/auth/get-session': replies.session,
      'GET /me/notifications': () => json(200, { items: [item(1), item(2), item(3)], total: 45, unread: 2, page: 1, pageSize: 20 }),
    });
    renderInbox();
    expect(await screen.findByRole('button', { name: /Person 1 joined Studio Wien/ })).toBeTruthy();
    const last = () => calls.filter((c) => c.path === '/me/notifications').at(-1)!.query;

    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    await waitFor(() => expect(last()).toContain('page=3'));

    fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'unread' } });
    await waitFor(() => expect(last()).toContain('status=unread'));
    expect(last()).toContain('page=1');

    fireEvent.change(screen.getByLabelText('About'), { target: { value: 'team' } });
    await waitFor(() => expect(last()).toContain('category=team'));
  });

  it('starts from the page and filters in the address', async () => {
    const calls = fakeFetch({
      'GET /api/auth/get-session': replies.session,
      'GET /me/notifications': () => json(200, { items: [item(3)], total: 45, unread: 0, page: 2, pageSize: 20 }),
    });
    renderInbox('/account/inbox?page=2&category=time_off');
    await screen.findByRole('button', { name: /Person 3 joined/ });
    const query = calls.find((c) => c.path === '/me/notifications')!.query;
    expect(query).toContain('page=2');
    expect(query).toContain('category=time_off');
    expect(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe('page');
  });
});
