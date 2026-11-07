// @vitest-environment jsdom
// Its own file: these change the signed-in user, which the auth client keeps
// at module level for the rest of a file.
import { fakeFetch, json, replies } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Account from './Account';

afterEach(cleanup);

/** The signed-in session, with the email it currently holds. */
function sessionWith(email: string) {
  return async () => {
    const body = (await replies.session().json()) as { user: Record<string, unknown> };
    return json(200, { ...body, user: { ...body.user, email } });
  };
}

async function openAccountTab() {
  render(
    <MemoryRouter initialEntries={['/account']}>
      <Routes>
        <Route path="/account" element={<Account />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('tab', { name: 'Account' }));
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('Account, changing your email', () => {
  it('sends the password and says what the email is now', async () => {
    let changed = false;
    const calls = fakeFetch({
      'GET /me/organizations': () => json(200, []),
      'GET /api/auth/get-session': () => sessionWith(changed ? 'new@example.com' : 'owner@example.com')(),
      'POST /api/auth/change-email': () => {
        changed = true;
        return json(200, { status: true });
      },
    });
    await openAccountTab();
    fireEvent.click(screen.getByRole('button', { name: 'Change email…' }));
    fill('New email', 'new@example.com');
    fill('Your password, to confirm', 'secret-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));

    expect(await screen.findByText(/Your email is now new@example.com/)).toBeTruthy();
    expect(calls.find((c) => c.path === '/api/auth/change-email')?.body).toMatchObject({
      newEmail: 'new@example.com',
      password: 'secret-password',
    });
  });

  it("says so when the address was taken and nothing changed", async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, []),
      'GET /api/auth/get-session': sessionWith('owner@example.com'),
      'POST /api/auth/change-email': () => json(200, { status: true }),
    });
    await openAccountTab();
    fireEvent.click(screen.getByRole('button', { name: 'Change email…' }));
    fill('New email', 'taken@example.com');
    fill('Your password, to confirm', 'secret-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
    expect(await screen.findByText(/Your email didn't change/)).toBeTruthy();
  });
});

describe('Account, changing your password', () => {
  it('signs out other devices and says so', async () => {
    const calls = fakeFetch({
      'GET /me/organizations': () => json(200, []),
      'GET /api/auth/get-session': sessionWith('owner@example.com'),
      'POST /api/auth/change-password': () => json(200, { token: null }),
    });
    await openAccountTab();
    fireEvent.click(screen.getByRole('button', { name: 'Change password…' }));
    fill('Current password', 'old-password');
    fill('New password', 'new-password-123');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/Every other device you were signed in on is signed out/)).toBeTruthy();
    expect(calls.find((c) => c.path === '/api/auth/change-password')?.body).toEqual({
      currentPassword: 'old-password',
      newPassword: 'new-password-123',
      revokeOtherSessions: true,
    });
  });

  it('says when the current password is wrong', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, []),
      'GET /api/auth/get-session': sessionWith('owner@example.com'),
      'POST /api/auth/change-password': () => json(400, { code: 'INVALID_PASSWORD', message: 'Invalid password' }),
    });
    await openAccountTab();
    fireEvent.click(screen.getByRole('button', { name: 'Change password…' }));
    fill('Current password', 'wrong');
    fill('New password', 'new-password-123');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('That password is not right.')).toBeTruthy();
  });
});
