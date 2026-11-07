import { describe, expect, it } from 'vitest';
import type { HistoryEvent } from './api';
import { historyLine } from './calendar-history';
import { fullMoment, timeOfDay } from './format';

const Z = 'Europe/Vienna';
const base: HistoryEvent = {
  kind: 'booked',
  at: '2031-02-01T13:03:00Z',
  actor: { kind: 'customer' },
  staffName: 'Ana',
  startsAt: '2031-02-03T08:00:00Z',
  endsAt: '2031-02-03T08:30:00Z',
  status: 'BOOKED',
  previousStaffName: null,
  previousStartsAt: null,
  previousEndsAt: null,
  previousStatus: null,
};

describe('historyLine', () => {
  it('says what was booked and that the customer did it', () => {
    expect(historyLine(base, Z).what).toBe(`Booked for ${fullMoment(base.startsAt!, Z)} with Ana by the customer`);
  });

  it('gives a same-day move just the new time', () => {
    const moved = { ...base, kind: 'moved' as const, actor: { kind: 'member' as const, name: 'Hanna' }, previousStartsAt: base.startsAt, previousStaffName: 'Ana', startsAt: '2031-02-03T09:00:00Z' };
    expect(historyLine(moved, Z).what).toBe(`Moved from ${fullMoment(base.startsAt!, Z)} with Ana to ${timeOfDay('2031-02-03T09:00:00Z', Z)} with Ana by Hanna`);
  });

  it('names a status change, and says when history began for old bookings', () => {
    expect(historyLine({ ...base, kind: 'status', status: 'CANCELLED' }, Z).what).toBe('Cancelled by the customer');
    const old = historyLine({ ...base, actor: { kind: 'unknown' } }, Z);
    expect(old.what).not.toMatch(/by /);
    expect(old.when).toMatch(/before history was kept/);
  });
});
