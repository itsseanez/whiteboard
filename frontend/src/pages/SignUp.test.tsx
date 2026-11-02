// @vitest-environment jsdom
import { fakeFetch, json, replies, type Call } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProvisionResult, SalonInput } from '../provision';

// The one mock: provisionSalon is Sean's to write and is a stub today. These
// tests pin the form's side of the contract — what it passes, and how it
// reacts to each result.
const provision = vi.hoisted(() => vi.fn<(input: SalonInput) => Promise<ProvisionResult>>());
vi.mock('../provision', () => ({ provisionSalon: provision }));

import SignUp from './SignUp';

const signUpOk = () =>
  json(200, {
    token: 'tok',
    user: {
      id: 'u2',
      name: 'Test Owner',
      email: 'owner@example.com',
      emailVerified: false,
      image: null,
      createdAt: '2026-11-02T07:30:00.000Z',
      updatedAt: '2026-11-02T07:30:00.000Z',
    },
  });

beforeEach(() => provision.mockReset());
afterEach(cleanup);

function renderSignUp() {
  render(
    <MemoryRouter initialEntries={['/signup']}>
      <Routes>
        <Route path="/signup" element={<SignUp />} />
        <Route path="/account" element={<p>account page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillValid() {
  type('Your name', 'Test Owner');
  type('Email', 'owner@example.com');
  type('Password', 'a-long-password');
  type('Salon name', "Marina's Cuts & Color");
}

const submit = () => fireEvent.submit(screen.getByRole('button', { name: /Create/ }));
const signUps = (calls: Call[]) =>
  calls.filter((c) => c.path === '/api/auth/sign-up/email');

describe('SignUp', () => {
  it('suggests the page address from the salon name until the owner edits it', () => {
    fakeFetch({});
    renderSignUp();
    type('Salon name', "Marina's Cuts & Color");
    expect(screen.getByLabelText<HTMLInputElement>('Page address').value).toBe('marinas-cuts-color');

    type('Page address', 'marina');
    type('Salon name', 'Something Else');
    expect(screen.getByLabelText<HTMLInputElement>('Page address').value).toBe('marina');
  });

  it('refuses a reserved address without contacting the server', async () => {
    const calls = fakeFetch({ 'POST /api/auth/sign-up/email': signUpOk });
    renderSignUp();
    fillValid();
    type('Page address', 'signin');
    submit();

    expect(await screen.findByText(/used by Whiteboard/)).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(provision).not.toHaveBeenCalled();
  });

  it('refuses a short password without contacting the server', async () => {
    const calls = fakeFetch({ 'POST /api/auth/sign-up/email': signUpOk });
    renderSignUp();
    fillValid();
    type('Password', 'short');
    submit();

    expect((await screen.findByRole('alert')).textContent).toMatch(/at least 8/i);
    expect(calls).toHaveLength(0);
  });

  it('creates the account, then provisions the salon, then lands on /account', async () => {
    const calls = fakeFetch({
      'POST /api/auth/sign-up/email': signUpOk,
      'GET /api/auth/get-session': replies.noSession,
    });
    provision.mockResolvedValue({ ok: true, slug: 'marinas-cuts-color' });
    renderSignUp();
    fillValid();
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/Vienna' } });
    submit();

    await screen.findByText('account page');
    expect(signUps(calls)[0]?.body).toMatchObject({
      name: 'Test Owner',
      email: 'owner@example.com',
      password: 'a-long-password',
    });
    expect(provision).toHaveBeenCalledWith({
      name: "Marina's Cuts & Color",
      slug: 'marinas-cuts-color',
      timezone: 'Europe/Vienna',
    });
  });

  it('keeps the account when provisioning fails, and a retry repeats only the salon step', async () => {
    const calls = fakeFetch({ 'POST /api/auth/sign-up/email': signUpOk });
    provision.mockResolvedValueOnce({ ok: false, reason: 'failed' });
    renderSignUp();
    fillValid();
    submit();

    expect((await screen.findByRole('alert')).textContent).toMatch(/account was created/i);
    expect(screen.getByLabelText<HTMLInputElement>('Email').disabled).toBe(true);

    provision.mockResolvedValueOnce({ ok: true, slug: 'marinas-cuts-color' });
    fireEvent.submit(screen.getByRole('button', { name: 'Create the salon' }));

    await screen.findByText('account page');
    expect(signUps(calls)).toHaveLength(1);
    expect(provision).toHaveBeenCalledTimes(2);
  });

  it('says the address is taken when provisioning reports it, and keeps the account', async () => {
    fakeFetch({ 'POST /api/auth/sign-up/email': signUpOk });
    provision.mockResolvedValue({ ok: false, reason: 'slug_taken' });
    renderSignUp();
    fillValid();
    submit();

    expect(await screen.findByText(/Another salon already has this address/)).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>('Email').disabled).toBe(true);
  });

  it('points an existing user to sign in and does not provision', async () => {
    fakeFetch({ 'POST /api/auth/sign-up/email': replies.userExists });
    renderSignUp();
    fillValid();
    submit();

    expect((await screen.findByRole('alert')).textContent).toMatch(/already exists/);
    await waitFor(() => expect(provision).not.toHaveBeenCalled());
  });
});
