// @vitest-environment jsdom
// Its own file: deleting signs the account out, which the auth client keeps at
// module level for the rest of a file.
import { fakeFetch, json, replies } from '@/test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Account from './Account';

afterEach(cleanup);

describe('Account, deleting it', () => {
  it('sends the password and goes home', async () => {
    const calls = fakeFetch({
      'GET /me/organizations': () => json(200, []),
      'GET /api/auth/get-session': replies.session,
      'POST /api/auth/delete-user': () => json(200, { success: true, message: 'User deleted' }),
    });
    render(
      <MemoryRouter initialEntries={['/account?tab=account']}>
        <Routes>
          <Route path="/account" element={<Account />} />
          <Route path="/" element={<p>home page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: 'Account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
    fireEvent.change(screen.getByLabelText('Your password, to confirm'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect(await screen.findByText('home page')).toBeTruthy();
    expect(calls.find((c) => c.path === '/api/auth/delete-user')?.body).toEqual({ password: 'secret-password' });
  });
});
