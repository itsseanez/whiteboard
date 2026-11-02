// @vitest-environment jsdom
// Its own file: the auth client holds the session at module level, so a test
// about the session on first load needs a module graph no other test touched.
import { fakeFetch, replies, type Call } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProvisionResult, SalonInput } from '../provision';

const provision = vi.hoisted(() => vi.fn<(input: SalonInput) => Promise<ProvisionResult>>());
vi.mock('../provision', () => ({ provisionSalon: provision }));

import SignUp from './SignUp';

afterEach(cleanup);

const signUps = (calls: Call[]) => calls.filter((c) => c.path === '/api/auth/sign-up/email');
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('SignUp, with a session already present', () => {
  // After a reload or a later visit, the account from an interrupted sign-up
  // must not be created again: that call fails with "already exists".
  it('skips the account step for a visitor who is already signed in', async () => {
    const calls = fakeFetch({ 'GET /api/auth/get-session': replies.session });
    provision.mockResolvedValue({ ok: true, slug: 'studio-wien' });
    render(
      <MemoryRouter initialEntries={['/signup']}>
        <Routes>
          <Route path="/signup" element={<SignUp />} />
          <Route path="/account" element={<p>account page</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.queryByLabelText('Password')).toBeNull());
    expect(screen.getByText(/owner@example.com/)).toBeTruthy();
    type('Salon name', 'Studio Wien');
    fireEvent.submit(screen.getByRole('button', { name: 'Create the salon' }));

    await screen.findByText('account page');
    expect(signUps(calls)).toHaveLength(0);
    expect(provision).toHaveBeenCalledWith(expect.objectContaining({ slug: 'studio-wien' }));
  });
});
