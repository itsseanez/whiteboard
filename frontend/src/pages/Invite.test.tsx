// @vitest-environment jsdom
import { fakeFetch, json, replies } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import Invite from './Invite';

afterEach(cleanup);

function renderInvite() {
  render(
    <MemoryRouter initialEntries={['/invite/inv1?email=ana%40acme.example']}>
      <Routes>
        <Route path="/invite/:id" element={<Invite />} />
        <Route path="/manage/:slug/me" element={<p>staff page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('Invite, signed out', () => {
  it('creates the account with the invited address, accepts, and opens their week', async () => {
    const calls = fakeFetch({
      'GET /api/auth/get-session': replies.noSession,
      'POST /api/auth/sign-up/email': replies.signedIn,
      'POST /me/invitations/inv1/accept': () => json(200, { slug: 'acme', role: 'member' }),
    });
    renderInvite();
    expect(((await screen.findByLabelText('Email')) as HTMLInputElement).value).toBe('ana@acme.example');
    type('Your name', 'Ana');
    type('Password', 'long-enough-password');
    fireEvent.click(screen.getByRole('button', { name: 'Create account and join' }));
    expect(await screen.findByText('staff page')).toBeTruthy();
    expect(calls.find((c) => c.path === '/api/auth/sign-up/email')?.body).toMatchObject({ email: 'ana@acme.example' });
  });

  it('says when the invitation has expired', async () => {
    fakeFetch({
      'GET /api/auth/get-session': replies.noSession,
      'POST /api/auth/sign-up/email': replies.signedIn,
      'POST /me/invitations/inv1/accept': () => json(410, { error: 'invitation_expired' }),
    });
    renderInvite();
    type('Your name', 'Ana');
    type('Password', 'long-enough-password');
    fireEvent.click(await screen.findByRole('button', { name: 'Create account and join' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/expired/));
  });

  it('links to sign-in, coming back here after', async () => {
    fakeFetch({ 'GET /api/auth/get-session': replies.noSession });
    renderInvite();
    const link = await screen.findByRole('link', { name: 'Sign in' });
    expect(link.getAttribute('href')).toBe(`/signin?next=${encodeURIComponent('/invite/inv1')}`);
  });
});
