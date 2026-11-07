// @vitest-environment jsdom
import { fakeFetch, json } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import Webhooks from './Webhooks';

afterEach(cleanup);

const hook = {
  id: 'h1',
  url: 'https://hooks.example.com/wb',
  createdAt: '2031-02-01T10:00:00Z',
  deliveries: [
    { label: 'appointment.booked', outcome: 'sent', attempts: 1, lastError: null, createdAt: '2031-02-01T10:05:00Z' },
    { label: 'ping', outcome: null, attempts: 2, lastError: 'answered 500', createdAt: '2031-02-01T10:06:00Z' },
  ],
};

describe('Webhooks', () => {
  it('lists deliveries and how they went', async () => {
    fakeFetch({ 'GET /tenant/wien/webhooks': () => json(200, { webhooks: [hook] }) });
    render(<Webhooks slug="wien" />);
    const list = await screen.findByRole('list', { name: 'Latest deliveries to https://hooks.example.com/wb' });
    expect(list.textContent).toMatch(/appointment\.booked.*delivered/);
    expect(list.textContent).toMatch(/ping.*retrying: answered 500/);
  });

  it('shows the secret once, after adding', async () => {
    const calls = fakeFetch({
      'GET /tenant/wien/webhooks': () => json(200, { webhooks: [] }),
      'POST /tenant/wien/webhooks': () => json(201, { id: 'h2', url: 'https://new.example.com/', secret: 'whsec_abc' }),
    });
    render(<Webhooks slug="wien" />);
    await screen.findByText('No connections yet.');
    fireEvent.change(screen.getByLabelText('Address from the other app'), { target: { value: 'https://new.example.com/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
    expect(await screen.findByText('whsec_abc')).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ url: 'https://new.example.com/' });
    fireEvent.click(screen.getByRole('button', { name: "I've saved it" }));
    expect(screen.queryByText('whsec_abc')).toBeNull();
  });

  it('explains a refused address', async () => {
    fakeFetch({
      'GET /tenant/wien/webhooks': () => json(200, { webhooks: [] }),
      'POST /tenant/wien/webhooks': () => json(400, { error: 'url must be a public address' }),
    });
    render(<Webhooks slug="wien" />);
    await screen.findByText('No connections yet.');
    fireEvent.change(screen.getByLabelText('Address from the other app'), { target: { value: 'http://169.254.169.254/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
    expect(await screen.findByText('The URL must be a public address.')).toBeTruthy();
  });

  it('queues a test without calling it a failure', async () => {
    const calls = fakeFetch({
      'GET /tenant/wien/webhooks': () => json(200, { webhooks: [hook] }),
      'POST /tenant/wien/webhooks/h1/test': () => new Response(null, { status: 202 }),
    });
    render(<Webhooks slug="wien" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Send a test' }));
    await screen.findByRole('list', { name: 'Connections' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.some((c) => c.path.endsWith('/test'))).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
