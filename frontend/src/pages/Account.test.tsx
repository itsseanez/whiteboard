// @vitest-environment jsdom
import { fakeFetch, json, replies } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Account from './Account';

afterEach(cleanup);

function renderAccount() {
  render(
    <MemoryRouter initialEntries={['/account']}>
      <Routes>
        <Route path="/account" element={<Account />} />
        <Route path="/" element={<p>landing page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Shape of GET /me/organizations, from backend/src/services/tenant.ts.
const salon = (slug: string, timezone: string) => ({
  tenantId: `id-${slug}`,
  slug,
  timezone,
  role: 'owner',
});

describe('Account', () => {
  it('says the visitor is not signed in on a 401, with a way to sign in', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(401, { error: 'Unauthorized' }),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();

    expect(await screen.findByText('Not signed in')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' }).getAttribute('href')).toBe('/signin');
  });

  it('says plainly when the account has no salon', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, []),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();

    expect(await screen.findByText(/not linked to a salon/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Finish setting up/ }).getAttribute('href')).toBe('/signup');
  });

  it('links every salon the account belongs to', async () => {
    fakeFetch({
      'GET /me/organizations': () =>
        json(200, [salon('studio-wien', 'Europe/Vienna'), salon('marinas-cuts-color', 'America/New_York')]),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();

    const host = window.location.host;
    expect((await screen.findByRole('link', { name: `${host}/studio-wien` })).getAttribute('href')).toBe(
      '/studio-wien',
    );
    expect(screen.getByRole('link', { name: `${host}/marinas-cuts-color` }).getAttribute('href')).toBe(
      '/marinas-cuts-color',
    );
  });

  it('says it cannot load on a server error rather than claiming no salon', async () => {
    fakeFetch({
      'GET /me/organizations': () => new Response('<html>', { status: 500 }),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();

    expect(await screen.findByText(/Can't load your account/)).toBeTruthy();
    expect(screen.queryByText(/not linked to a salon/)).toBeNull();
  });

  it('signs out through Better Auth and returns to the landing page', async () => {
    const calls = fakeFetch({
      'GET /me/organizations': () => json(200, [salon('studio-wien', 'Europe/Vienna')]),
      'GET /api/auth/get-session': replies.noSession,
      'POST /api/auth/sign-out': () => json(200, { success: true }),
    });
    renderAccount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    await screen.findByText('landing page');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/auth/sign-out')).toBe(true);
  });

  it('stays put and says so when signing out fails', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, [salon('studio-wien', 'Europe/Vienna')]),
      'GET /api/auth/get-session': replies.noSession,
      'POST /api/auth/sign-out': () => new Response('', { status: 500 }),
    });
    renderAccount();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/still signed in/i);
    expect(screen.queryByText('landing page')).toBeNull();
  });
});
