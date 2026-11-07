// @vitest-environment jsdom
import { fakeFetch, replies } from '@/test/fake-api'; // first: see the file
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import TopBar from './TopBar';

afterEach(cleanup);

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TopBar />
    </MemoryRouter>,
  );

describe('TopBar, signed out', () => {
  it('links the wordmark home and offers sign in on the home page', async () => {
    fakeFetch({ 'GET /api/auth/get-session': replies.noSession });
    renderAt('/');
    expect((await screen.findByRole('link', { name: 'Sign in' })).getAttribute('href')).toBe('/signin');
    expect(screen.getByRole('link', { name: "Don't have an account?" })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Whiteboard' }).getAttribute('href')).toBe('/');
  });

  it("keeps a customer's booking page free of sign-in links", async () => {
    fakeFetch({ 'GET /api/auth/get-session': replies.noSession });
    renderAt('/studio-wien');
    await screen.findByRole('link', { name: 'Whiteboard' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Account menu' })).toBeNull();
  });
});
