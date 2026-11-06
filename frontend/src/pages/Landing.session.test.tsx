// @vitest-environment jsdom
// Its own file: the auth client holds the session at module level (see
// SignUp.resume.test.tsx), so a signed-in visitor needs a fresh module graph.
import { fakeFetch, replies } from '../test/fake-api'; // first: see the file
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Landing from './Landing';

afterEach(cleanup);

describe('Landing top bar, signed in', () => {
  it('shows who is signed in and links to their account', async () => {
    fakeFetch({ 'GET /api/auth/get-session': replies.session });
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Landing />} />
        </Routes>
      </MemoryRouter>,
    );

    const account = await screen.findByRole('link', { name: 'Your account' });
    expect(account.getAttribute('href')).toBe('/account');
    expect(screen.getByText('Signed in as owner@example.com')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Whiteboard' }).getAttribute('href')).toBe('/account');
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
  });
});
