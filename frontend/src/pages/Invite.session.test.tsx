// @vitest-environment jsdom
// Its own file: the auth client holds the session at module level (see
// SignUp.resume.test.tsx), so a signed-in visitor needs a fresh module graph.
import { fakeFetch, json, replies } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Invite from './Invite';

afterEach(cleanup);

describe('Invite, signed in as someone else', () => {
  it('names the invited address and offers to sign out', async () => {
    fakeFetch({
      'GET /api/auth/get-session': replies.session,
      'POST /me/invitations/inv1/accept': () => json(403, { error: 'wrong_account' }),
    });
    render(
      <MemoryRouter initialEntries={['/invite/inv1?email=ana%40acme.example']}>
        <Routes>
          <Route path="/invite/:id" element={<Invite />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/signed in as owner@example.com/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/for ana@acme.example/);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
