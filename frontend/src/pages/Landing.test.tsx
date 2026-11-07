// @vitest-environment jsdom
import { fakeFetch, json, type Call } from '../test/fake-api'; // first: see the file
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Landing from './Landing';

// Shapes captured from the dev API: GET /:slug/services, /availability, and
// POST /:slug/appointments.
const catalog = (slug: string, name: string, timeZone: string, service: string, minutes: number) => () =>
  json(200, {
    tenant: { name, slug, timeZone },
    services: [
      {
        id: `svc-${slug}`,
        name: service,
        durationMinutes: minutes,
        staff: [{ id: `staff-${slug}`, name: 'Stylist' }],
      },
    ],
  });
const wien = catalog('studio-wien', 'Studio Wien', 'Europe/Vienna', 'Full Color', 150);
const marina = catalog('marinas-cuts-color', "Marina's Cuts & Color", 'America/New_York', 'Cut', 45);

const slot = (slug: string, startsAt: string) => ({ startsAt, endsAt: startsAt, staffIds: [`staff-${slug}`] });
type Day = { date: string; status: 'closed' } | { date: string; status: 'open'; slots: unknown[] };
const availability = (timeZone: string, days: Day[]) => () =>
  json(200, { timeZone, noQualifiedStaff: false, days });

function prefersReducedMotion(on: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: on && query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function renderLanding() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/:slug" element={<p>booking page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const timeButtons = () => screen.queryAllByRole('button', { name: /^\d{1,2}:\d{2}/ });

const wienDays: Day[] = [
  { date: '2026-11-02', status: 'open', slots: [] },
  {
    date: '2026-11-03',
    status: 'open',
    slots: [slot('studio-wien', '2026-11-03T09:00:00Z'), slot('studio-wien', '2026-11-03T09:15:00Z')],
  },
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T06:00:00Z')); // Monday 07:00 in Vienna
  prefersReducedMotion(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Landing live booking', () => {
  it("opens on Studio Wien's first day with times, in Vienna time, nothing chosen yet", async () => {
    fakeFetch({
      'GET /studio-wien/services': wien,
      'GET /studio-wien/availability': availability('Europe/Vienna', wienDays),
    });
    renderLanding();

    // 09:00Z is 10:00 in Vienna in November (UTC+1).
    expect(await screen.findByRole('button', { name: /^10:00/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^10:15/ })).toBeTruthy();
    expect(timeButtons().filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(0);
  });

  it("asks for the rest of the organization's month, starting from the organization's today", async () => {
    vi.setSystemTime(new Date('2026-11-02T23:30:00Z')); // already Tuesday in Vienna
    const calls = fakeFetch({
      'GET /studio-wien/services': wien,
      'GET /studio-wien/availability': availability('Europe/Vienna', []),
    });
    renderLanding();

    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/availability'))).toBe(true));
    const query = new URLSearchParams(calls.find((c) => c.path.endsWith('/availability'))!.query);
    expect(query.get('from')).toBe('2026-11-03');
    expect(query.get('through')).toBe('2026-11-30');
  });

  it("switches to Marina's and shows her times in New York time", async () => {
    fakeFetch({
      'GET /studio-wien/services': wien,
      'GET /studio-wien/availability': availability('Europe/Vienna', wienDays),
      'GET /marinas-cuts-color/services': marina,
      'GET /marinas-cuts-color/availability': availability('America/New_York', [
        { date: '2026-11-02', status: 'open', slots: [slot('marinas-cuts-color', '2026-11-02T15:00:00Z')] },
      ]),
    });
    renderLanding();
    await screen.findByRole('button', { name: /^10:00/ });

    fireEvent.click(screen.getByRole('button', { name: "Marina's Cuts & Color" }));

    // 15:00Z is 10:00 in New York in November (UTC-5); Vienna's 10:15 is gone.
    expect(await screen.findByRole('button', { name: /^10:00/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^10:15/ })).toBeNull();
    expect(screen.getByRole('button', { name: "Marina's Cuts & Color" }).getAttribute('aria-pressed')).toBe('true');
  });

  it('books the chosen time right here and shows the confirmation, without leaving the page', async () => {
    const calls = fakeFetch({
      'GET /studio-wien/services': wien,
      'GET /studio-wien/availability': availability('Europe/Vienna', wienDays),
      'POST /studio-wien/appointments': () =>
        json(201, {
          appointmentId: 'appt-1',
          staffId: 'staff-studio-wien',
          startsAt: '2026-11-03T09:00:00Z',
          endsAt: '2026-11-03T11:30:00Z',
          manageToken: 'tok-123',
          emailed: true,
        }),
    });
    renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: /^10:00/ }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /^Book 10:00/ }));

    expect(await screen.findByText("You're booked")).toBeTruthy();
    expect(screen.queryByText('booking page')).toBeNull();
    expect(screen.getByText(/manage\?token=tok-123/)).toBeTruthy();
    expect(screen.getByText(/We've emailed you this link too/)).toBeTruthy();
    expect(calls.find((c: Call) => c.method === 'POST')).toMatchObject({
      path: '/studio-wien/appointments',
      body: {
        serviceId: 'svc-studio-wien',
        staffId: 'staff-studio-wien',
        startsAt: '2026-11-03T09:00:00Z',
        customer: { name: 'Ada Lovelace', email: 'ada@example.com' },
      },
    });
  });

  // The form is tall and the confirmation short: without this, "You're booked"
  // lands above the viewport and the visitor sees nothing happen.
  it('brings the confirmation into view after booking', async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    fakeFetch({
      'GET /studio-wien/services': wien,
      'GET /studio-wien/availability': availability('Europe/Vienna', wienDays),
      'POST /studio-wien/appointments': () =>
        json(201, {
          appointmentId: 'appt-1',
          staffId: 'staff-studio-wien',
          startsAt: '2026-11-03T09:00:00Z',
          endsAt: '2026-11-03T11:30:00Z',
          manageToken: 'tok-123',
        }),
    });
    renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: /^10:00/ }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /^Book 10:00/ }));

    const done = await screen.findByText("You're booked");
    await waitFor(() => expect(scrolled.some((el) => el.contains(done))).toBe(true));
    // @ts-expect-error restore jsdom's absence
    delete Element.prototype.scrollIntoView;
  });

  it('says when someone else took the time, and refreshes the times', async () => {
    const calls = fakeFetch({
      'GET /studio-wien/services': wien,
      'GET /studio-wien/availability': availability('Europe/Vienna', wienDays),
      'POST /studio-wien/appointments': () => json(409, { error: 'slot_taken' }),
    });
    renderLanding();

    fireEvent.click(await screen.findByRole('button', { name: /^10:00/ }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ada@example.com' } });
    fireEvent.submit(screen.getByRole('button', { name: /^Book 10:00/ }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/just took that time/);
    expect(screen.queryByText("You're booked")).toBeNull();
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/studio-wien/availability')).toHaveLength(2),
    );
  });

  it('says so when the organization cannot be reached', async () => {
    fakeFetch({ 'GET /studio-wien/services': () => new Response('<html>', { status: 500 }) });
    renderLanding();

    expect(await screen.findByText(/couldn't load/i)).toBeTruthy();
    expect(timeButtons()).toHaveLength(0);
  });
});

describe('Landing', () => {
  it('says what it is, in the first heading', () => {
    fakeFetch({});
    renderLanding();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Online booking platform.');
  });

  it('has no other "book" links: booking happens in the tile, or from the three organization links', () => {
    fakeFetch({});
    renderLanding();

    expect(screen.queryAllByRole('link', { name: /^book/i })).toHaveLength(0);
    const rail = screen.getByRole('list', { name: 'Demo organizations' });
    const hrefs = [...rail.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/studio-wien', '/signup','/marinas-cuts-color']);
  });

  // The design system: text is in the HTML, script only adds the hidden
  // starting state. These place every element below the fold, where the
  // reveal would act, and give it an observer it can drive.
  describe('reveal', () => {
    let observers: { cb: IntersectionObserverCallback; targets: Element[] }[];
    beforeEach(() => {
      observers = [];
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        top: 5000, bottom: 5100, left: 0, right: 100, width: 100, height: 100, x: 0, y: 5000, toJSON: () => ({}),
      } as DOMRect);
      globalThis.IntersectionObserver = class {
        targets: Element[] = [];
        constructor(public cb: IntersectionObserverCallback) {
          observers.push(this);
        }
        observe(el: Element) { this.targets.push(el); }
        unobserve() {}
        disconnect() {}
        takeRecords() { return []; }
        root = null; rootMargin = ''; thresholds = [];
      } as unknown as typeof IntersectionObserver;
    });
    afterEach(() => {
      vi.restoreAllMocks();
      // @ts-expect-error jsdom has none; leave it that way for other tests
      delete globalThis.IntersectionObserver;
    });

    it('hides tile text below the fold, then shows each piece once it scrolls into view', () => {
      prefersReducedMotion(false);
      fakeFetch({});
      renderLanding();

      const hidden = document.querySelectorAll('[data-reveal="hidden"]');
      expect(hidden.length).toBeGreaterThan(0);
      const target = hidden[0]!;
      const observer = observers.find((o) => o.targets.includes(target))!;
      observer.cb([{ isIntersecting: true, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
      expect(target.getAttribute('data-reveal')).toBe('shown');
    });

    it('never hides text that is already on screen when the page loads', () => {
      prefersReducedMotion(false);
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
        top: 10, bottom: 110, left: 0, right: 100, width: 100, height: 100, x: 0, y: 10, toJSON: () => ({}),
      } as DOMRect);
      fakeFetch({});
      renderLanding();
      expect(document.querySelectorAll('[data-reveal="hidden"]')).toHaveLength(0);
    });

    it('hides no text with reduced motion on', () => {
      prefersReducedMotion(true);
      fakeFetch({});
      renderLanding();
      expect(document.querySelectorAll('[data-reveal="hidden"]')).toHaveLength(0);
    });

    it('hides no text when the browser cannot observe the page to reveal it', () => {
      prefersReducedMotion(false);
      // @ts-expect-error simulating a browser without it
      delete globalThis.IntersectionObserver;
      fakeFetch({});
      renderLanding();
      expect(document.querySelectorAll('[data-reveal="hidden"]')).toHaveLength(0);
    });

    it('never hides anything in the booking tile: the scene is its only motion', () => {
      prefersReducedMotion(false);
      fakeFetch({});
      renderLanding();
      const tile = screen.getByRole('region', { name: 'Book at a demo organization' });
      expect(tile.querySelectorAll('[data-reveal]')).toHaveLength(0);
    });
  });
});
