// @vitest-environment jsdom
// Its own file: the auth client holds the session at module level (see
// SignUp.resume.test.tsx), so a signed-in visitor needs a fresh module graph.
import { fakeFetch, json, replies } from '@/test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import TopBar from './TopBar';

afterEach(cleanup);

describe('TopBar, signed in', () => {
  it('opens a profile menu with the account page and sign out', async () => {
    const calls = fakeFetch({
      'GET /api/auth/get-session': replies.session,
      'POST /api/auth/sign-out': () => json(200, { success: true }),
    });
    render(
      <MemoryRouter initialEntries={['/manage/acme']}>
        <TopBar />
        <Routes>
          <Route path="/" element={<p>home page</p>} />
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>,
    );
    const button = await screen.findByRole('button', { name: 'Account menu' });
    expect(screen.getByRole('link', { name: 'Whiteboard' }).getAttribute('href')).toBe('/');
    expect(screen.queryByRole('link', { name: 'Your account' })).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Signed in as owner@example.com')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Your account' }).getAttribute('href')).toBe('/account');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('link', { name: 'Your account' })).toBeNull();

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('home page')).toBeTruthy();
    expect(calls.some((c) => c.path === '/api/auth/sign-out')).toBe(true);
  });
});
