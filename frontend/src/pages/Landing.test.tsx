// @vitest-environment jsdom
import { fakeFetch, json } from '../test/fake-api'; // first: see the file
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Landing from './Landing';

// Shapes captured from the dev API: GET /studio-wien/services and /availability.
const catalog = () =>
  json(200, {
    tenant: { name: 'Studio Wien', slug: 'studio-wien', timeZone: 'Europe/Vienna' },
    services: [
      {
        id: 'b2222222-2222-2222-2222-222222222222',
        name: 'Full Color',
        durationMinutes: 150,
        staff: [{ id: 'a2222222-2222-2222-2222-222222222222', name: 'Anna Huber' }],
      },
    ],
  });
const slot = (startsAt: string) => ({ startsAt, endsAt: startsAt, staffIds: ['a2222222-2222-2222-2222-222222222222'] });
type Day = { date: string; status: 'closed' } | { date: string; status: 'open'; slots: unknown[] };
const availability = (days: Day[]) => () =>
  json(200, { timeZone: 'Europe/Vienna', noQualifiedStaff: false, days });

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
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T06:00:00Z')); // Monday 07:00 in Vienna
  prefersReducedMotion(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Landing scroll scene', () => {
  it("shows the scene's final frame with reduced motion: a day picked and one time chosen, in Vienna time", async () => {
    fakeFetch({
      'GET /studio-wien/services': catalog,
      'GET /studio-wien/availability': availability([
        { date: '2026-11-02', status: 'open', slots: [] },
        { date: '2026-11-03', status: 'open', slots: [slot('2026-11-03T09:00:00Z'), slot('2026-11-03T09:15:00Z')] },
      ]),
    });
    renderLanding();

    // 09:00Z is 10:00 in Vienna in November (UTC+1).
    const ten = await screen.findByRole('button', { name: /^10:00/ });
    expect(screen.getByRole('button', { name: /^10:15/ })).toBeTruthy();
    const times = screen.getAllByRole('button', { name: /^\d{1,2}:\d{2}/ });
    expect(times.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(ten.getAttribute('aria-pressed')).toBe('true');
  });

  it("asks for the rest of the salon's month, starting from the salon's today", async () => {
    vi.setSystemTime(new Date('2026-11-02T23:30:00Z')); // already Tuesday in Vienna
    const calls = fakeFetch({
      'GET /studio-wien/services': catalog,
      'GET /studio-wien/availability': availability([]),
    });
    renderLanding();

    await waitFor(() => expect(calls.some((c) => c.path.endsWith('/availability'))).toBe(true));
    const query = new URLSearchParams(calls.find((c) => c.path.endsWith('/availability'))!.query);
    expect(query.get('from')).toBe('2026-11-03');
    expect(query.get('through')).toBe('2026-11-30');
  });

  it('says so, and still offers a way in, when the salon cannot be reached', async () => {
    fakeFetch({ 'GET /studio-wien/services': () => new Response('<html>', { status: 500 }) });
    renderLanding();

    expect(await screen.findByText(/couldn't load/i)).toBeTruthy();
    expect(screen.queryAllByRole('button', { name: /^\d{1,2}:\d{2}/ })).toHaveLength(0);
  });
});

describe('Landing tiles', () => {
  it('opens with what it is and two actions: book at a demo salon, or create one', () => {
    fakeFetch({});
    renderLanding();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Online booking for salons');
    expect(screen.getAllByRole('link', { name: 'Book at Studio Wien' })[0]!.getAttribute('href')).toBe('/studio-wien');
    expect(screen.getAllByRole('link', { name: 'Create a salon' })[0]!.getAttribute('href')).toBe('/signup');
    expect(screen.getAllByRole('link', { name: 'Sign in' })[0]!.getAttribute('href')).toBe('/signin');
  });

  it('says plainly that this is a demo, in the hero', () => {
    fakeFetch({});
    renderLanding();
    expect(screen.getByText(/working demo, free to try/i)).toBeTruthy();
  });

  it('links both demo salons from the rail', () => {
    fakeFetch({});
    renderLanding();
    expect(screen.getByRole('link', { name: /Marina's Cuts & Color/ }).getAttribute('href')).toBe('/marinas-cuts-color');
    expect(screen.getAllByRole('link', { name: /Studio Wien/ }).some((a) => a.getAttribute('href') === '/studio-wien')).toBe(true);
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
  });
});
