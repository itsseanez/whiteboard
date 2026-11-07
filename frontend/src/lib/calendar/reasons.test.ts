import { describe, expect, it } from 'vitest';
import type { CalendarAppointment, ExcludedTime } from '@/lib/api';
import { explain, explainFor, type ReasonContext } from './reasons';

// Times follow the viewer's locale, so sentences are matched by their words
// and times only by pattern.
const color: CalendarAppointment = {
  id: 'a1',
  staffId: 's1',
  serviceId: 'v1',
  serviceName: 'Color',
  resourceId: 'r1',
  resourceName: 'Wash station',
  startsAt: '2026-11-16T15:00:00Z',
  endsAt: '2026-11-16T16:30:00Z',
  customer: { id: 'c1', name: 'Jo', email: 'jo@example.com', phone: null },
};

const ctx: ReasonContext = {
  timeZone: 'UTC',
  serviceName: 'Cut',
  staffName: (id) => ({ s1: 'Ana', s2: 'Ben' })[id] ?? 'Someone',
  resourceName: (id) => (id === 'r1' ? 'Wash station' : 'A resource'),
  appointment: (id) => (id === 'a1' ? color : undefined),
};

const T = /\d{1,2}:\d{2}/;

describe('calendar reasons', () => {
  it('writes one sentence per staff member, naming the appointment that holds them', () => {
    const excluded: ExcludedTime = {
      startsAt: '2026-11-16T15:15:00Z',
      reason: [
        { reason: 'busy', staffId: 's1', busyInterval: { startsAt: '2026-11-16T15:00:00Z', endsAt: '2026-11-16T16:45:00Z', appointmentId: 'a1' } },
        { reason: 'outsideWorkingHours', staffId: 's2' },
      ],
    };
    const lines = explain(excluded, ctx);
    expect(lines[0]).toMatch(/^Ana is with a customer \(Color, /);
    expect(lines[0]).toMatch(T);
    expect(lines[1]).toBe("Ben isn't working then.");
  });

  it('falls back to the busy times when the appointment is not loaded', () => {
    const excluded: ExcludedTime = {
      startsAt: '2026-11-16T15:15:00Z',
      reason: [{ reason: 'busy', staffId: 's1', busyInterval: { startsAt: '2026-11-16T15:00:00Z', endsAt: '2026-11-16T16:00:00Z', appointmentId: 'gone' } }],
    };
    expect(explain(excluded, ctx)[0]).toMatch(/^Ana is with a customer \(booked /);
  });

  it('explains organization-wide reasons the same for everyone', () => {
    const resource: ExcludedTime = {
      startsAt: '2026-11-16T15:15:00Z',
      reason: { reason: 'noAvailableResource', conflicts: [{ resourceId: 'r1', busyInterval: { startsAt: '2026-11-16T15:00:00Z', endsAt: '2026-11-16T16:30:00Z', appointmentId: 'a1' } }] },
    };
    expect(explainFor('s2', resource, ctx)[0]).toMatch(/^Wash station is in use \(Color, /);

    const closing: ExcludedTime = { startsAt: '2026-11-16T19:30:00Z', reason: { reason: 'doesNotFitBeforeClosing', closesAt: '2026-11-16T20:00:00Z' } };
    expect(explain(closing, ctx)[0]).toMatch(/^A Cut starting then wouldn't finish before closing at /);

    const soon: ExcludedTime = { startsAt: '2026-11-16T09:00:00Z', reason: { reason: 'tooSoon', earliestBookableAt: '2026-11-16T10:00:00Z' } };
    expect(explain(soon, ctx)[0]).toMatch(/^Too soon to book\. The earliest Cut is /);
  });

  it('gives one staff member only their own reason', () => {
    const excluded: ExcludedTime = {
      startsAt: '2026-11-16T15:15:00Z',
      reason: [
        { reason: 'timeOff', staffId: 's1', timeOff: { startsAt: '2026-11-16T00:00:00Z', endsAt: '2026-11-17T00:00:00Z' } },
        { reason: 'outsideWorkingHours', staffId: 's2' },
      ],
    };
    expect(explainFor('s1', excluded, ctx)).toEqual([expect.stringMatching(/^Ana is off \(/)]);
    expect(explainFor('s3', excluded, ctx)).toEqual([]);
  });
});
