import { describe as group, expect, it } from 'vitest';
import type { InboxItem } from './api';
import { fullMoment, timeOffLabel } from './format';
import { ago, describe } from './inbox';
import { pageNumbers } from '@/pages/inbox/Inbox';

const item = (kind: InboxItem['kind'], data: InboxItem['data']): InboxItem => ({
  id: 'n1', kind, category: 'appointments', link: '/', data, createdAt: '2031-02-01T10:00:00Z', read: false,
});

group('describe', () => {
  it('words a booking in the organization’s zone', () => {
    const n = item('appointment_booked', {
      organization: 'Studio Wien', timeZone: 'Europe/Vienna', service: 'Cut', customer: 'Cleo', staff: 'Ana',
      startsAt: '2031-02-03T08:00:00Z', byCustomer: true,
    });
    expect(describe(n)).toEqual({
      title: 'New booking: Cut with Cleo',
      detail: `${fullMoment('2031-02-03T08:00:00Z', 'Europe/Vienna')} with Ana · Studio Wien · booked online`,
    });
  });

  it('words time off and people joining', () => {
    const asked = item('time_off_requested', { organization: 'Studio Wien', timeZone: 'UTC', staff: 'Ana', startsAt: '2031-06-01T00:00:00Z', endsAt: '2031-06-02T00:00:00Z', reason: 'wedding' });
    expect(describe(asked)).toEqual({ title: 'Ana asked for time off', detail: `${timeOffLabel('2031-06-01T00:00:00Z', '2031-06-02T00:00:00Z', 'UTC')} · wedding · Studio Wien` });
    expect(describe(item('member_joined', { organization: 'Studio Wien', person: 'Ben', role: 'admin' }))).toEqual({ title: 'Ben joined Studio Wien', detail: 'As a manager' });
  });
});

group('ago', () => {
  it('counts minutes, then hours', () => {
    const now = Date.parse('2031-02-01T12:00:00Z');
    expect(ago('2031-02-01T11:59:40Z', now)).toBe('just now');
    expect(ago('2031-02-01T11:55:00Z', now)).toBe('5 min ago');
    expect(ago('2031-02-01T09:00:00Z', now)).toBe('3 h ago');
  });
});

group('pageNumbers', () => {
  it('keeps the first, the last and the neighbourhood, with gaps', () => {
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(10, 20)).toEqual([1, 'gap', 8, 9, 10, 11, 12, 'gap', 20]);
    expect(pageNumbers(1, 20)).toEqual([1, 2, 3, 'gap', 20]);
  });
});
