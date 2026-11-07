// @vitest-environment jsdom
import { fakeFetch, replies } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import SignIn from './SignIn';

afterEach(cleanup);

function renderAt(path = '/signin') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/account" element={<p>account page</p>} />
        <Route path="/invite/:id" element={<p>invite page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'anna@studiowien.example' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'demo-password-123' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Sign in' }));
}

describe('SignIn', () => {
  it('posts the credentials to Better Auth and lands on /account', async () => {
    const calls = fakeFetch({
      'POST /api/auth/sign-in/email': replies.signedIn,
      'GET /api/auth/get-session': replies.noSession,
    });
    renderAt();
    fillAndSubmit();

    await screen.findByText('account page');
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/auth/sign-in/email',
      body: { email: 'anna@studiowien.example', password: 'demo-password-123' },
    });
  });

  it('says the credentials are wrong on a 401', async () => {
    fakeFetch({ 'POST /api/auth/sign-in/email': replies.wrongPassword });
    renderAt();
    fillAndSubmit();

    expect((await screen.findByRole('alert')).textContent).toMatch(/do not match/);
    expect(screen.queryByText('account page')).toBeNull();
  });

  // The §1a symptom: the request never reaches Express. Not the user's fault,
  // so it must not read like a password problem.
  it.each([
    ['404 from Vite', replies.viteNotFound],
    ['502 from the proxy', replies.proxyDown],
  ])('says sign-in is unavailable on a %s', async (_name, reply) => {
    fakeFetch({ 'POST /api/auth/sign-in/email': reply });
    renderAt();
    fillAndSubmit();

    const alert = (await screen.findByRole('alert')).textContent ?? '';
    expect(alert).toMatch(/unavailable/);
    expect(alert).not.toMatch(/do not match/);
  });

  it('says Whiteboard is unreachable when no response arrives at all', async () => {
    fakeFetch({
      'POST /api/auth/sign-in/email': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    renderAt();
    fillAndSubmit();

    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not reach/);
  });

  it('sends one request when the form is submitted twice in a row', async () => {
    let release!: (r: Response) => void;
    const calls = fakeFetch({
      'POST /api/auth/sign-in/email': () => new Promise<Response>((r) => (release = r)),
    });
    renderAt();
    fillAndSubmit();
    fireEvent.submit(screen.getByRole('button', { name: /Sign/ }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(screen.getByRole('button', { name: /Signing in/ })).toHaveProperty('disabled', true);
    release(replies.wrongPassword());
    await screen.findByRole('alert');
    expect(calls.filter((c) => c.path === '/api/auth/sign-in/email')).toHaveLength(1);
  });

  it('returns to the page that sent them, but only on this site', async () => {
    fakeFetch({ 'POST /api/auth/sign-in/email': replies.signedIn, 'GET /api/auth/get-session': replies.noSession });
    renderAt(`/signin?next=${encodeURIComponent('/invite/inv1')}`);
    fillAndSubmit();
    expect(await screen.findByText('invite page')).toBeTruthy();
    cleanup();
    fakeFetch({ 'POST /api/auth/sign-in/email': replies.signedIn, 'GET /api/auth/get-session': replies.noSession });
    renderAt(`/signin?next=${encodeURIComponent('//evil.example')}`);
    fillAndSubmit();
    expect(await screen.findByText('account page')).toBeTruthy();
  });
});
