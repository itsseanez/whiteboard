// @vitest-environment jsdom
// Its own file: a confirmed user, and the auth client keeps the signed-in
// user at module level for the rest of a file.
import { fakeFetch, json, replies } from '@/test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Account from './Account';

afterEach(cleanup);

/** The signed-in session, with the email it currently holds. */
function sessionWith(email: string, emailVerified = false) {
  return async () => {
    const body = (await replies.session().json()) as { user: Record<string, unknown> };
    return json(200, { ...body, user: { ...body.user, email, emailVerified } });
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

describe('Account, a confirmed email', () => {
  it('tells a confirmed user the change waits for the link', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, []),
      'GET /api/auth/get-session': sessionWith('owner@example.com', true),
      'POST /api/auth/change-email': () => json(200, { status: true }),
    });
    await openAccountTab();
    await screen.findByText('owner@example.com');
    expect(screen.queryByText(/not confirmed/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change email…' }));
    fill('New email', 'next@example.com');
    fill('Your password, to confirm', 'secret-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
    expect(await screen.findByText(/we've emailed it a link. Your email changes when you open it/)).toBeTruthy();
  });
});
