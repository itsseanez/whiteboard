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
const organization = (slug: string, timezone: string, role = 'owner') => ({
  tenantId: `id-${slug}`,
  name: `Name of ${slug}`,
  slug,
  timezone,
  role,
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

  it('says plainly when the account has no organization', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, []),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();

    expect(await screen.findByText(/You don't run an organization yet/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New organization' }).getAttribute('href')).toBe('/signup');
  });

  it('links every organization the account belongs to', async () => {
    fakeFetch({
      'GET /me/organizations': () =>
        json(200, [organization('studio-wien', 'Europe/Vienna'), organization('marinas-cuts-color', 'America/New_York')]),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();

    expect(await screen.findByText('Name of studio-wien')).toBeTruthy();
    const pages = screen.getAllByRole('link', { name: 'View' }).map((l) => l.getAttribute('href'));
    expect(pages).toEqual(['/studio-wien', '/marinas-cuts-color']);
  });

  it('says it cannot load on a server error rather than claiming no organization', async () => {
    fakeFetch({
      'GET /me/organizations': () => new Response('<html>', { status: 500 }),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();

    expect(await screen.findByText(/Can't load your account/)).toBeTruthy();
    expect(screen.queryByText(/not linked to an organization/)).toBeNull();
  });

  it('signs out through Better Auth and returns to the landing page', async () => {
    const calls = fakeFetch({
      'GET /me/organizations': () => json(200, [organization('studio-wien', 'Europe/Vienna')]),
      'GET /api/auth/get-session': replies.noSession,
      'POST /api/auth/sign-out': () => json(200, { success: true }),
    });
    renderAccount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await screen.findByText('landing page');
    expect(calls.some((c) => c.method === 'POST' && c.path === '/api/auth/sign-out')).toBe(true);
  });

  it('stays put and says so when signing out fails', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, [organization('studio-wien', 'Europe/Vienna')]),
      'GET /api/auth/get-session': replies.noSession,
      'POST /api/auth/sign-out': () => new Response('', { status: 500 }),
    });
    renderAccount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/still signed in/i);
    expect(screen.queryByText('landing page')).toBeNull();
  });

  it('splits managed organizations and staff work into their own tabs', async () => {
    fakeFetch({
      'GET /me/organizations': () =>
        json(200, [organization('acme', 'UTC', 'admin'), organization('studio-wien', 'Europe/Vienna', 'member')]),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();
    expect((await screen.findByRole('tab', { name: 'Organizations' })).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('link', { name: 'Edit' }).getAttribute('href')).toBe('/manage/acme');
    expect(screen.getAllByRole('link').filter((l) => l.closest('li')).map((l) => l.textContent)).toEqual(['Edit', 'View']);
    expect(screen.queryByRole('link', { name: 'Your week' })).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Your week' }));
    expect(screen.getByRole('link', { name: 'Your week' }).getAttribute('href')).toBe('/manage/studio-wien/me');
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
  });

  it('moves between tabs with the arrow keys', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, [organization('acme', 'UTC')]),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();
    fireEvent.keyDown(await screen.findByRole('tab', { name: 'Organizations' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Account' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Account' }));
  });

  it('leaves out the staff tab for someone who only manages', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, [organization('acme', 'UTC')]),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();
    await screen.findByRole('tab', { name: 'Organizations' });
    expect(screen.queryByRole('tab', { name: 'Your week' })).toBeNull();
  });

  it('lists a closed organization for its owner and reopens it', async () => {
    let closedAt: string | null = '2026-11-01T12:00:00Z';
    const calls = fakeFetch({
      'GET /me/organizations': () =>
        json(200, [{ ...organization('acme', 'UTC'), closedAt, reopenUntil: closedAt ? '2026-12-01T12:00:00Z' : null }]),
      'POST /me/tenants/acme/reopen': () => {
        closedAt = null;
        return json(200, { slug: 'acme' });
      },
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();
    expect(await screen.findByRole('heading', { name: 'Closed' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Name of acme' }));
    expect(await screen.findByRole('link', { name: 'Edit' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Closed' })).toBeNull();
    expect(calls.some((c) => c.path === '/me/tenants/acme/reopen')).toBe(true);
  });

  it('offers a new organization to someone who already runs one', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, [organization('acme', 'UTC')]),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();
    expect((await screen.findByRole('link', { name: 'New organization' })).getAttribute('href')).toBe('/signup');
  });

  it('opens on their week for someone who only works as staff', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, [organization('acme', 'UTC', 'member')]),
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAccount();
    expect((await screen.findByRole('tab', { name: 'Your week' })).getAttribute('aria-selected')).toBe('true');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Your week', 'Organizations', 'Account']);
  });

  it('refuses to delete the account of someone who still owns an organization, and says which', async () => {
    fakeFetch({
      'GET /me/organizations': () => json(200, [organization('acme', 'UTC')]),
      'GET /api/auth/get-session': replies.noSession,
      'POST /api/auth/delete-user': () =>
        json(400, { code: 'OWNS_ORGANIZATIONS', message: 'Close the organizations you own first: Acme.' }),
    });
    renderAccount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete account…' }));
    fireEvent.change(screen.getByLabelText('Your password, to confirm'), { target: { value: 'secret-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Close the organizations you own first: Acme.');
  });
});
