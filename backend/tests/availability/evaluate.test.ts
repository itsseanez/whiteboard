// Function 10: evaluateGridTime. One candidate time in, a verdict out — either
// a Slot listing everyone who could take it, or an ExcludedTime saying why not.
//
// The two things these tests pin: the ORDER of the checks (business-wide reasons
// first, and they stop the rest) and WHICH span each check uses (service for
// hours, shifts and time off; blocked for appointments and resources).

import { describe, it, expect } from 'vitest';
import { evaluateGridTime, type GridTimeContext } from '../../src/availability/engine.js';
import {
  busy,
  expectSlot,
  expectStaffReasons,
  expectTenantReason,
  interval,
  minutes,
  resource,
  schedule,
  service,
  zoned,
} from '../../src/availability/fixtures.js';

const DAY = '2026-06-15';
const shift = interval(zoned(DAY, '09:00'), zoned(DAY, '17:00'));
const openPeriod = shift;

function context(overrides: Partial<GridTimeContext> = {}): GridTimeContext {
  return {
    startsAt: overrides.startsAt ?? zoned(DAY, '10:00'),
    openPeriod: overrides.openPeriod ?? openPeriod,
    earliestBookableAt: overrides.earliestBookableAt ?? zoned(DAY, '00:00'),
    service: overrides.service ?? service({ duration: minutes(60) }),
    staff: overrides.staff ?? [schedule('s1', { workingPeriods: [shift] })],
    resources: overrides.resources ?? [],
  };
}

describe('evaluateGridTime — a bookable time', () => {
  it('lists every staff member who could take it', () => {
    const verdict = evaluateGridTime(
      context({
        staff: [
          schedule('s1', { workingPeriods: [shift] }),
          schedule('s2', { workingPeriods: [shift] }),
        ],
      }),
    );

    const slot = expectSlot(verdict);
    expect(slot.staffIds).toEqual(['s1', 's2']);
    expect(slot.resourceIds).toEqual([]);
    // Start and end are the SERVICE times the customer sees, not the buffered ones.
    expect(slot.startsAt).toEqual(zoned(DAY, '10:00'));
    expect(slot.endsAt).toEqual(zoned(DAY, '11:00'));
  });

  it('drops only the staff who cannot take it', () => {
    const verdict = evaluateGridTime(
      context({
        staff: [
          schedule('s1', {
            workingPeriods: [shift],
            busyIntervals: [busy('a1', zoned(DAY, '10:30'), zoned(DAY, '11:30'))],
          }),
          schedule('s2', { workingPeriods: [shift] }),
        ],
      }),
    );

    expect(expectSlot(verdict).staffIds).toEqual(['s2']);
  });

  it('allows a service that ends exactly at closing', () => {
    // Half-open: the service may finish at the closing moment.
    const verdict = evaluateGridTime(context({ startsAt: zoned(DAY, '16:00') }));

    expect(expectSlot(verdict).endsAt).toEqual(zoned(DAY, '17:00'));
  });

  it('allows a before-buffer that reaches back outside the shift', () => {
    // The settled rule: buffers are prep, not work. A stylist whose shift starts
    // at 09:00 can take a 09:00 booking whose buffer starts at 08:50.
    const verdict = evaluateGridTime(
      context({
        startsAt: zoned(DAY, '09:00'),
        service: service({ duration: minutes(60), beforeBuffer: minutes(10) }),
      }),
    );

    expect(expectSlot(verdict).staffIds).toEqual(['s1']);
  });

  it('allows an after-buffer that runs into time off', () => {
    // Time off only matters once the stylist's work is done. Service ends 12:55,
    // buffer runs to 13:05, time off begins 13:00 — still bookable.
    const verdict = evaluateGridTime(
      context({
        startsAt: zoned(DAY, '12:00'),
        service: service({ duration: minutes(55), afterBuffer: minutes(10) }),
        staff: [
          schedule('s1', {
            workingPeriods: [shift],
            timeOff: [interval(zoned(DAY, '13:00'), zoned(DAY, '17:00'))],
          }),
        ],
      }),
    );

    expect(expectSlot(verdict).staffIds).toEqual(['s1']);
  });

  it('allows an appointment that ends exactly where the blocked span begins', () => {
    const verdict = evaluateGridTime(
      context({
        startsAt: zoned(DAY, '10:00'),
        service: service({ duration: minutes(60), beforeBuffer: minutes(10) }),
        staff: [
          schedule('s1', {
            workingPeriods: [shift],
            // Ends at 09:50, which is where the blocked span starts. Touching is
            // not colliding.
            busyIntervals: [busy('a1', zoned(DAY, '09:00'), zoned(DAY, '09:50'))],
          }),
        ],
      }),
    );

    expect(expectSlot(verdict).staffIds).toEqual(['s1']);
  });
});

describe('evaluateGridTime — business-wide refusals', () => {
  it('reports tooSoon with the earliest moment that would work', () => {
    const verdict = evaluateGridTime(
      context({ startsAt: zoned(DAY, '10:00'), earliestBookableAt: zoned(DAY, '12:00') }),
    );

    expect(verdict).toEqual({
      startsAt: zoned(DAY, '10:00'),
      reason: { reason: 'tooSoon', earliestBookableAt: zoned(DAY, '12:00') },
    });
  });

  it('reports doesNotFitBeforeClosing with the closing moment', () => {
    // A 60-minute service starting 16:15 runs to 17:15, past a 17:00 close.
    const verdict = evaluateGridTime(context({ startsAt: zoned(DAY, '16:15') }));

    expect(verdict).toEqual({
      startsAt: zoned(DAY, '16:15'),
      reason: { reason: 'doesNotFitBeforeClosing', closesAt: zoned(DAY, '17:00') },
    });
  });

  it('reports tooSoon ahead of everything else', () => {
    // Fully booked AND too soon. The order of the checks is the design: one true
    // business-wide reason beats a list of irrelevant per-staff ones.
    const verdict = evaluateGridTime(
      context({
        startsAt: zoned(DAY, '10:00'),
        earliestBookableAt: zoned(DAY, '12:00'),
        staff: [
          schedule('s1', {
            workingPeriods: [shift],
            busyIntervals: [busy('a1', zoned(DAY, '09:00'), zoned(DAY, '17:00'))],
          }),
        ],
      }),
    );

    expect(expectTenantReason(verdict).reason).toBe('tooSoon');
  });
});

describe('evaluateGridTime — per-staff refusals', () => {
  it('reports one reason per staff member when nobody can take it', () => {
    // The completeness invariant: the list length equals the candidate count, so
    // a consumer can say "all of them" with confidence.
    const verdict = evaluateGridTime(
      context({
        staff: [
          schedule('s1', {
            workingPeriods: [shift],
            busyIntervals: [busy('a1', zoned(DAY, '10:00'), zoned(DAY, '11:00'))],
          }),
          schedule('s2', {
            workingPeriods: [shift],
            busyIntervals: [busy('a2', zoned(DAY, '09:30'), zoned(DAY, '12:00'))],
          }),
        ],
      }),
    );

    expect(verdict).toEqual({
      startsAt: zoned(DAY, '10:00'),
      reason: [
        {
          reason: 'busy',
          staffId: 's1',
          busyInterval: busy('a1', zoned(DAY, '10:00'), zoned(DAY, '11:00')),
        },
        {
          reason: 'busy',
          staffId: 's2',
          busyInterval: busy('a2', zoned(DAY, '09:30'), zoned(DAY, '12:00')),
        },
      ],
    });
  });

  it('mixes reason kinds across staff', () => {
    const verdict = evaluateGridTime(
      context({
        staff: [
          schedule('s1', {
            workingPeriods: [shift],
            busyIntervals: [busy('a1', zoned(DAY, '10:00'), zoned(DAY, '11:00'))],
          }),
          // No shift covers 10:00 at all.
          schedule('s2', { workingPeriods: [interval(zoned(DAY, '13:00'), zoned(DAY, '17:00'))] }),
          schedule('s3', {
            workingPeriods: [shift],
            timeOff: [interval(zoned(DAY, '09:00'), zoned(DAY, '12:00'))],
          }),
        ],
      }),
    );

    expect(expectStaffReasons(verdict).map((r) => r.reason)).toEqual([
      'busy',
      'outsideWorkingHours',
      'timeOff',
    ]);
  });

  it('carries no detail on outsideWorkingHours', () => {
    // Deliberate. There may be no shift that day, or two with the time sitting
    // in the gap between them, so naming one would be arbitrary.
    const verdict = evaluateGridTime(context({ staff: [schedule('s1', { workingPeriods: [] })] }));

    expect(verdict).toEqual({
      startsAt: zoned(DAY, '10:00'),
      reason: [{ reason: 'outsideWorkingHours', staffId: 's1' }],
    });
  });

  it('refuses a time in the gap of a split shift', () => {
    const verdict = evaluateGridTime(
      context({
        startsAt: zoned(DAY, '12:30'),
        openPeriod: interval(zoned(DAY, '09:00'), zoned(DAY, '17:00')),
        staff: [
          schedule('s1', {
            workingPeriods: [
              interval(zoned(DAY, '09:00'), zoned(DAY, '12:00')),
              interval(zoned(DAY, '13:00'), zoned(DAY, '17:00')),
            ],
          }),
        ],
      }),
    );

    expect(expectStaffReasons(verdict)[0]?.reason).toBe('outsideWorkingHours');
  });

  it('refuses a service that straddles the gap of a split shift', () => {
    // 11:30 + 60 minutes reaches 12:30, inside the lunch gap. Containment is
    // checked against whole merged periods, so this is correctly refused even
    // though both endpoints are near working time.
    const verdict = evaluateGridTime(
      context({
        startsAt: zoned(DAY, '11:30'),
        staff: [
          schedule('s1', {
            workingPeriods: [
              interval(zoned(DAY, '09:00'), zoned(DAY, '12:00')),
              interval(zoned(DAY, '13:00'), zoned(DAY, '17:00')),
            ],
          }),
        ],
      }),
    );

    expect(expectStaffReasons(verdict)[0]?.reason).toBe('outsideWorkingHours');
  });

  it('refuses when a buffer collides with another appointment', () => {
    // The mirror of the time-off case above, and the pair is what pins the whole
    // buffer rule. Service ends 12:55, buffer runs to 13:05, and this time the
    // thing at 13:00 is an appointment rather than time off.
    const verdict = evaluateGridTime(
      context({
        startsAt: zoned(DAY, '12:00'),
        service: service({ duration: minutes(55), afterBuffer: minutes(10) }),
        staff: [
          schedule('s1', {
            workingPeriods: [shift],
            busyIntervals: [busy('a1', zoned(DAY, '13:00'), zoned(DAY, '14:00'))],
          }),
        ],
      }),
    );

    expect(expectStaffReasons(verdict)[0]?.reason).toBe('busy');
  });
});

describe('evaluateGridTime — resources', () => {
  it('lists the free resources on a bookable time', () => {
    const verdict = evaluateGridTime(
      context({ resources: [resource('r1'), resource('r2')] }),
    );

    expect(expectSlot(verdict).resourceIds).toEqual(['r1', 'r2']);
  });

  it('drops only the occupied resource', () => {
    const verdict = evaluateGridTime(
      context({
        resources: [
          resource('r1', [busy('a1', zoned(DAY, '10:30'), zoned(DAY, '11:30'))]),
          resource('r2'),
        ],
      }),
    );

    expect(expectSlot(verdict).resourceIds).toEqual(['r2']);
  });

  it('blocks a resource for the buffers too', () => {
    // A wash station needs preparing and cleaning, so it is checked against the
    // BLOCKED span. The appointment here does not touch the service span at all.
    const verdict = evaluateGridTime(
      context({
        startsAt: zoned(DAY, '10:00'),
        service: service({ duration: minutes(60), afterBuffer: minutes(10) }),
        resources: [resource('r1', [busy('a1', zoned(DAY, '11:05'), zoned(DAY, '12:00'))])],
      }),
    );

    expect(verdict).toEqual({
      startsAt: zoned(DAY, '10:00'),
      reason: {
        reason: 'noAvailableResource',
        conflicts: [
          {
            resourceId: 'r1',
            busyInterval: busy('a1', zoned(DAY, '11:05'), zoned(DAY, '12:00')),
          },
        ],
      },
    });
  });

  it('reports every conflict when no resource is free', () => {
    const verdict = evaluateGridTime(
      context({
        resources: [
          resource('r1', [busy('a1', zoned(DAY, '09:00'), zoned(DAY, '17:00'))]),
          resource('r2', [busy('a2', zoned(DAY, '10:00'), zoned(DAY, '11:00'))]),
        ],
      }),
    );

    const reason = expectTenantReason(verdict);
    expect(reason.reason === 'noAvailableResource' && reason.conflicts.map((c) => c.resourceId)).toEqual(
      ['r1', 'r2'],
    );
  });

  it('does not report a resource problem for a service that needs none', () => {
    const verdict = evaluateGridTime(context({ resources: [] }));

    expect(expectSlot(verdict).resourceIds).toEqual([]);
  });

  it('reports the staff reasons when staff and resources both fail', () => {
    // Precedence. In practice both failures are usually the same appointments
    // seen from two angles, and the staff reasons name the cause rather than the
    // consequence.
    const verdict = evaluateGridTime(
      context({
        staff: [
          schedule('s1', {
            workingPeriods: [shift],
            busyIntervals: [busy('a1', zoned(DAY, '10:00'), zoned(DAY, '11:00'))],
          }),
        ],
        resources: [resource('r1', [busy('a1', zoned(DAY, '10:00'), zoned(DAY, '11:00'))])],
      }),
    );

    expect(expectStaffReasons(verdict)[0]?.reason).toBe('busy');
  });
});
