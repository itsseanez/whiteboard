// @vitest-environment jsdom
import { fakeFetch, json } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { ForgotPassword, ResetPassword } from './PasswordReset';
import SignIn from './SignIn';

afterEach(cleanup);

function at(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signin/forgot" element={<ForgotPassword />} />
        <Route path="/signin/reset" element={<ResetPassword />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('forgotten passwords', () => {
  it('is offered from sign-in', () => {
    fakeFetch({});
    at('/signin');
    expect(screen.getByRole('link', { name: 'Forgot your password?' }).getAttribute('href')).toBe('/signin/forgot');
  });

  it('asks for a link without saying whether the account exists', async () => {
    const calls = fakeFetch({ 'POST /api/auth/request-password-reset': () => json(200, { status: true }) });
    at('/signin/forgot');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'jo@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a link' }));
    expect(await screen.findByText(/If there's an account for jo@example.com/)).toBeTruthy();
    expect(calls[0]?.body).toMatchObject({ email: 'jo@example.com' });
  });

  it('posts the token from the link with the new password', async () => {
    const calls = fakeFetch({ 'POST /api/auth/reset-password': () => json(200, { status: true }) });
    at('/signin/reset?token=tok-1');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText(/Your password is changed/)).toBeTruthy();
    expect(calls[0]?.body).toEqual({ newPassword: 'a-new-password', token: 'tok-1' });
  });

  it('says a used or expired link is, and offers a new one', async () => {
    fakeFetch({ 'POST /api/auth/reset-password': () => json(400, { code: 'INVALID_TOKEN', message: 'Invalid token' }) });
    at('/signin/reset?token=old');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByText(/expired or was already used/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Get a new link' })).toBeTruthy();
  });

  it('treats a link with no token as expired', () => {
    fakeFetch({});
    at('/signin/reset');
    expect(screen.getByText(/expired or was already used/)).toBeTruthy();
  });
});
